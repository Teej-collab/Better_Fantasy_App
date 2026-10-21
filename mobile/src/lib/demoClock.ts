// Showreel recordings only (Documentation/Marketing/Showreel/native/):
// EXPO_PUBLIC_DEMO_NOW, an ISO time, shifts the app's clock to it so the
// Living Home and every countdown show that day on cue. It is never set
// for a real build, so in the app people use this does nothing.
const demoNow = process.env.EXPO_PUBLIC_DEMO_NOW;

if (demoNow) {
  const offset = Date.parse(demoNow) - Date.now();
  if (!Number.isNaN(offset)) {
    const RealDate = Date;
    class DemoDate extends RealDate {
      constructor(...args: ConstructorParameters<DateConstructor> | []) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...(args as ConstructorParameters<DateConstructor>));
      }

      static now(): number {
        return RealDate.now() + offset;
      }
    }
    globalThis.Date = DemoDate as DateConstructor;
  }
}

export {};
