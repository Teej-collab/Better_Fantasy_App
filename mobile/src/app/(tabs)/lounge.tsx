import { LoungeLobby } from '@/components/lounge/LoungeLobby';
import { TabFrame } from '@/components/TabFrame';

// The Lounge tab: the lobby — who's watching what, and the games that
// matter to you right now.
export default function LoungeTab() {
  return (
    <TabFrame>
      <LoungeLobby />
    </TabFrame>
  );
}
