import { TabFrame } from '@/components/TabFrame';
import { LivingHome } from '@/components/living/LivingHome';

// Home is the living home for everyone (2026-10-20: the only home now;
// the classic home and its switch are gone).
export default function HomeScreen() {
  return (
    <TabFrame>
      <LivingHome />
    </TabFrame>
  );
}
