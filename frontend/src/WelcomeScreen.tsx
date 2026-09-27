type WelcomeScreenProps = {
  onGetStarted: () => void
}

export default function WelcomeScreen({ onGetStarted }: WelcomeScreenProps) {
  return (
    <>
      <img
        src={`${import.meta.env.BASE_URL}nyc-skyline.png`}
        alt="Nighttime view of the Manhattan skyline, with lit towers and the river beyond"
        className="absolute inset-0 h-full w-full object-cover object-center select-none"
        draggable={false}
      />

      <div
        className="absolute inset-0"
        style={{
          background: [
            'linear-gradient(to bottom, rgba(3,8,24,0.80) 0%, rgba(3,8,24,0.32) 22%, rgba(3,8,24,0.08) 45%, rgba(3,8,24,0.18) 65%, rgba(3,8,24,0.86) 100%)',
            'radial-gradient(ellipse 90% 60% at 50% 48%, transparent 0%, rgba(3,8,24,0.28) 100%)',
          ].join(', '),
        }}
      />

      <div className="relative z-10 flex h-full min-h-0 w-full flex-col px-7 pt-14 pb-10 text-center">
        <div className="flex items-center justify-center gap-2.5">
          <LocationPin />
          <span
            className="text-xs font-semibold tracking-[0.22em] text-white/60 uppercase"
            style={{ fontFamily: 'Outfit, sans-serif' }}
          >
            NYC Navigator
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-0">
          <h1
            className="text-center leading-none font-black tracking-[-0.03em] whitespace-nowrap text-white"
            style={{ fontFamily: 'Outfit, sans-serif', fontSize: 'clamp(2.65rem, 12.2cqw, 3.15rem)' }}
          >
            Way<span className="text-[#60a5fa]">Aware</span>
          </h1>

          <p
            className="mt-4 text-center leading-tight font-semibold text-white/90"
            style={{ fontFamily: 'Outfit, sans-serif', fontSize: 'clamp(1.25rem, 6cqw, 1.6rem)' }}
          >
            Know what's ahead.
          </p>

          <p
            className="mt-4 w-full text-center text-[0.95rem] leading-relaxed font-bold text-white"
            style={{ fontFamily: 'Inter, sans-serif' }}
          >
            Navigate NYC with real-time incident awareness and historical crime patterns.
          </p>
        </div>

        <div className="flex flex-col items-stretch gap-4 pt-6">
          <button
            type="button"
            onClick={onGetStarted}
            data-focus-id="welcome"
            className="w-full rounded-2xl py-[17px] text-[1.05rem] font-bold tracking-wide text-white transition-all duration-150 focus-visible:ring-2 focus-visible:ring-[#60a5fa] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-none active:scale-[0.97]"
            style={{
              fontFamily: 'Outfit, sans-serif',
              background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 60%, #60a5fa 100%)',
              boxShadow: '0 4px 32px rgba(59,130,246,0.45), 0 1px 6px rgba(0,0,0,0.4)',
            }}
          >
            Get Started
          </button>

          <p className="text-center text-[0.84rem] text-white" style={{ fontFamily: 'Inter, sans-serif' }}>
            Already have an account?{' '}
            <button type="button" className="font-semibold text-white underline-offset-2 focus-visible:outline-none">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </>
  )
}

function LocationPin() {
  return (
    <svg width="18" height="20" viewBox="0 0 18 22" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M9 1C5.134 1 2 4.134 2 8c0 5.25 7 13 7 13s7-7.75 7-13c0-3.866-3.134-7-7-7z"
        fill="#3b82f6"
        fillOpacity="0.9"
      />
      <circle cx="9" cy="8" r="2.5" fill="white" fillOpacity="0.95" />
    </svg>
  )
}
