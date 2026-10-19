import asyncio
import uuid

from app import scheduler, scheduler_lease


def _name() -> str:
    # Its own lease row, never the real "scheduler" one prod is holding.
    return f"test-{uuid.uuid4().hex[:12]}"


async def test_only_one_copy_holds_the_lease_until_it_lets_go(pool):
    name = _name()
    async with pool.acquire() as conn:
        try:
            assert await scheduler_lease.try_hold(conn, name, "copy-a", 20)
            # A second copy is refused while the first holds it...
            assert not await scheduler_lease.try_hold(conn, name, "copy-b", 20)
            # ...the first can keep renewing...
            assert await scheduler_lease.try_hold(conn, name, "copy-a", 20)
            assert not await scheduler_lease.try_hold(conn, name, "copy-b", 20)
            # ...and once it gives it up, the other takes over.
            await scheduler_lease.release(conn, name, "copy-a")
            assert await scheduler_lease.try_hold(conn, name, "copy-b", 20)
            # A stale release from the old holder doesn't free it.
            await scheduler_lease.release(conn, name, "copy-a")
            assert not await scheduler_lease.try_hold(conn, name, "copy-a", 20)
        finally:
            await conn.execute("DELETE FROM scheduler_lease WHERE name = $1", name)


async def test_a_copy_that_stops_renewing_loses_the_lease(pool):
    name = _name()
    async with pool.acquire() as conn:
        try:
            assert await scheduler_lease.try_hold(conn, name, "copy-a", 1)
            assert not await scheduler_lease.try_hold(conn, name, "copy-b", 20)
            await asyncio.sleep(1.5)
            assert await scheduler_lease.try_hold(conn, name, "copy-b", 20)
            assert not await scheduler_lease.try_hold(conn, name, "copy-a", 20)
        finally:
            await conn.execute("DELETE FROM scheduler_lease WHERE name = $1", name)


async def test_heartbeat_flags_leadership_and_drops_it_when_another_copy_holds_it(pool, monkeypatch):
    name = _name()
    monkeypatch.setattr(scheduler_lease, "LEASE_NAME", name)
    monkeypatch.setattr(scheduler_lease, "_leader", False)
    try:
        await scheduler_lease.heartbeat()
        assert scheduler_lease.is_leader()

        # Someone else has it (ours ran out and they took it).
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE scheduler_lease SET holder = 'other-copy', expires_at = now() + interval '20 seconds' WHERE name = $1",
                name,
            )
        await scheduler_lease.heartbeat()
        assert not scheduler_lease.is_leader()
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM scheduler_lease WHERE name = $1", name)


async def test_give_up_releases_the_lease_for_the_next_copy(pool, monkeypatch):
    name = _name()
    monkeypatch.setattr(scheduler_lease, "LEASE_NAME", name)
    monkeypatch.setattr(scheduler_lease, "_leader", False)
    try:
        await scheduler_lease.heartbeat()
        assert scheduler_lease.is_leader()
        await scheduler_lease.give_up()
        assert not scheduler_lease.is_leader()
        async with pool.acquire() as conn:
            assert await scheduler_lease.try_hold(conn, name, "next-copy", 20)
    finally:
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM scheduler_lease WHERE name = $1", name)


async def test_a_failed_renewal_pauses_jobs(monkeypatch):
    async def broken_pool():
        raise ConnectionError("database unreachable")

    monkeypatch.setattr(scheduler_lease, "_leader", True)
    monkeypatch.setattr(scheduler_lease, "get_pool", broken_pool)
    await scheduler_lease.heartbeat()
    assert not scheduler_lease.is_leader()


async def test_jobs_run_only_on_the_lease_holder(monkeypatch):
    ran = []

    async def job(x):
        ran.append(x)

    guarded = scheduler._leader_only(job)
    assert guarded.__name__ == "job"

    monkeypatch.setattr(scheduler_lease, "_leader", False)
    await guarded(1)
    assert ran == []

    monkeypatch.setattr(scheduler_lease, "_leader", True)
    await guarded(2)
    assert ran == [2]


async def test_without_the_table_every_copy_runs_jobs_as_before(monkeypatch):
    import asyncpg

    async def no_table(*args, **kwargs):
        raise asyncpg.UndefinedTableError('relation "scheduler_lease" does not exist')

    monkeypatch.setattr(scheduler_lease, "_leader", False)
    monkeypatch.setattr(scheduler_lease, "try_hold", no_table)
    await scheduler_lease.heartbeat()
    assert scheduler_lease.is_leader()
