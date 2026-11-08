// Decorative atlas emblems, not clinical diagrams. The live model provides anatomical detail.
export default function LabIllustration({ labId }) {
  const drawings = {
    kidney: <>
      <path d="M111 39C88 18 58 35 49 65c-9 30-3 69 20 81 20 11 44 1 43-18-1-14-20-14-22-30-2-15 24-17 27-34 2-10 0-19-6-25Z"/>
      <path d="M101 47C85 34 67 47 62 70c-5 24-2 53 13 62 10 6 21 4 23-4M89 98l39-10 23 5M104 80l24-5 23 4M91 102c12 9 29 7 32 23l3 29"/>
      <path d="m71 62 12 7m-17 8 13 5m-14 11 13 1m-11 15 12-4m-6 17 10-7"/>
    </>,
    aorta: <>
      <path d="M58 151V89c0-41 24-57 49-47 20 8 26 24 26 52v57M77 151V88c0-22 13-31 25-24 10 6 12 17 12 31v56"/>
      <path d="m73 47-8-18-15-7m29 21L72 24M93 39V16m12 25 2-24m10 33 13-25m-5 35 16-31"/>
      <path d="m132 100 19 7m-18 10 18 7m-18 9 18 7"/>
    </>,
    spine: <>
      {[34, 62, 90, 118].map((y, i) => <g key={y} transform={`translate(${i * -2} ${y})`}>
        <path d="M77 0c9-3 29-3 38 0l2 14c-11 5-32 5-43 0l3-14Z"/>
        <path d="m76 5-19 4-7 8 24-4m42-8 18 4 7 8-24-4M85 20h23"/>
      </g>)}
      <path d="M96 18v9m-8 119v13"/>
    </>,
    willis: <>
      <path d="M95 155v-35l-25-18 1-25 24-18 24 18 1 25-25 18M88 155v-32l-25-18 1-31 24-19V27m14 0v28l24 19 1 31-25 18v32"/>
      <path d="M70 81 46 67 24 70m47 20L43 76 23 79m96 2 24-14 23 3m-46 21 26-15 21 3M88 40 74 23m28 17 14-17M68 103l-24 18-17-1m97-17 24 18 17-1"/>
    </>,
    carotid: <>
      <path d="M82 155V97c0-17 6-29 14-42l10-33m-6 133V99c0-14 4-25 11-38l12-34"/>
      <path d="M84 83 62 59 52 26m43 39L76 49 68 22M72 50l-27-5-15-15m32 29-22-4-15-14M111 60l26-11 14-20m-47 46 32-13 22-25"/>
      <path d="M90 135v-24m23-70 3-9"/>
    </>,
    artery: <>
      <path d="M88 18v95l-27 40m43-135v95l27 40M88 51 65 43 37 48m51 14-24-9-26 5m66-7 24-8 27 5m-51 14 24-9 26 5M88 113l8 7 8-7M75 133l-14 20m56-20 14 20"/>
      <path d="M88 80 70 87m34-7 18 7M88 95l-14 7m30-7 14 7M96 29v13"/>
    </>,
  }
  return <svg className="lab-illustration" viewBox="0 0 192 176" fill="none" aria-hidden="true">
    <g className="illustration-guides" stroke="currentColor" strokeWidth=".7">
      <circle cx="96" cy="88" r="66"/><circle cx="96" cy="88" r="79" strokeDasharray="1 5"/>
      <path d="M6 88h22m136 0h22M96 1v15m0 144v15"/>
    </g>
    <g className="illustration-anatomy" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{drawings[labId] ?? drawings.kidney}</g>
  </svg>
}
