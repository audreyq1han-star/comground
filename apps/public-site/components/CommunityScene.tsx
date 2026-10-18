type Scene = 'garden' | 'pantry' | 'reading';

/** Original, code-native illustration. No actual people, places, or partners depicted. */
export function CommunityScene({ scene = 'garden', className = '' }: { scene?: Scene; className?: string }) {
  return <svg className={`community-scene ${className}`} viewBox="0 0 760 650" role="img" aria-label={scene === 'garden' ? 'Illustration of people tending a shared garden beneath a sunny blue sky' : scene === 'pantry' ? 'Illustration of people arranging boxes at a fictional community pantry' : 'Illustration of a reading desk with books, a lamp, and a leafy plant'}>
    <rect width="760" height="650" fill="#a4d8ef" />
    <circle cx="600" cy="115" r="71" fill="#ffd9a0" />
    <path d="M0 235H53V189H143V252H190V159H292V230H344V201H441V257H506V175H619V228H687V192H760V650H0Z" fill="#74b8d6" />
    <path d="M0 332H760V650H0Z" fill="#0e6289" />
    <path d="M-20 462C186 329 475 406 798 316V650H-20Z" fill="#0e1f2e" />
    <path d="M-20 619C196 412 436 632 811 445" stroke="#237c84" strokeWidth="62" fill="none" />
    <g fill="none" stroke="#e8f3ed" strokeWidth="9" strokeLinecap="round"><path d="M86 103h88m-68-17h48" /><path d="M339 68h103m-82-17h58" /></g>
    {scene === 'garden' ? <>
      <g stroke="#bbd7bb" strokeWidth="3" opacity=".65"><path d="M0 361H760M0 392H760" /><path d="M54 332v90m80-90v90m80-90v90m80-90v90m80-90v90m80-90v90m80-90v90m80-90v90m80-90v90" /></g>
      <g transform="translate(448 267)"><path d="M50 55v207" stroke="#406758" strokeWidth="9" /><path d="M51 117C-26 119-19 57 12 50c42-9 54 36 39 67Zm0-40C28 10 89-12 106 12c27 36-7 68-55 65Zm0 101c3-66 68-69 75-39 9 38-42 49-75 39Z" fill="#06c4b0" /><path d="M50 226c-5-61-63-73-78-43-15 32 33 50 78 43Z" fill="#70d3a8" /></g>
      <path d="M256 482l348-19 70 57-350 32Z" fill="#b27b54" /><path d="M324 552l350-32v82l-350 32Z" fill="#ce9267" /><path d="M256 482l68 70v82l-68-70Z" fill="#956443" /><path d="M277 483l326-13 43 38-321 31Z" fill="#372e2a" />
      <g fill="#8fcb83"><path d="M359 515c-62-5-39-44-9-20 0-52 45-47 27-12 57-17 56 23 13 31Z" /><path d="M452 506c-52-10-40-51-8-28-1-48 45-41 28-7 53-13 51 27 8 33Z" /><path d="M549 500c-48-9-35-45-9-23-4-48 43-43 27-9 49-12 48 22 9 31Z" /></g>
      <g><path d="M174 402l-28 154 23 4 57-131 16 126 26-3-9-167Z" fill="#f6e4bf" /><path d="m142 551 31 3-1 23h-51c-6-15 12-18 21-26Zm95-1 29-2 15 24h-45Z" fill="#e7a175" /><path d="M178 280c-31 21-25 92-17 128 33 24 72 22 104-8l-23-102Z" fill="#f8795b" /><path d="m226 295 28 70 77 14-4 19-98-14-35-75Z" fill="#f8795b" /><path d="m326 379 29 6c14 3 9 20-5 19l-24-6Z" fill="#a75c3f" /><path d="M177 281v-40h46v49" fill="#a75c3f" /><ellipse cx="203" cy="224" rx="30" ry="37" fill="#a75c3f" /><path d="M173 227c-24-22-7-59 29-57 42 2 41 40 22 49l-4-22c-19 16-36-1-47 30Z" fill="#112a39" /><path d="m166 309-40 62 36 56 17-10-18-47 31-43" fill="#f8795b" /></g>
      <g><path d="m590 362-6 111 25 1 23-94 31 98 26-7-24-124Z" fill="#087f84" /><path d="m582 468 31 2-5 20h-40Zm77 2 29-5 14 20-41 6Z" fill="#132b3e" /><path d="M601 245c-15 27-23 69-15 123 28 18 63 9 85-15l-18-101Z" fill="#ffda94" /><path d="m612 263-47 77-65-12-7 19 83 18 62-80Z" fill="#ffda94" /><path d="m500 328-25-10c-12-3-17 13-6 19l24 10Z" fill="#ce9267" /><path d="M613 247v-26h35v30" fill="#ce9267" /><ellipse cx="633" cy="206" rx="27" ry="33" fill="#ce9267" /><path d="M606 204c-6-37 13-53 40-42 24 10 22 31 11 48l-9-31-42 25Z" fill="#243d40" /><circle cx="660" cy="170" r="18" fill="#243d40" /></g>
      <g fill="#e8f3ed"><path d="m60 554 21 17 38-21-3 45-48 6Z" /><path d="m81 570-9-30h5l11 28Z" /></g>
    </> : scene === 'pantry' ? <>
      <rect x="104" y="267" width="552" height="259" rx="4" fill="#f4dfbe" /><rect x="119" y="282" width="522" height="225" fill="#243d40" />
      <path d="M125 356h510m-510 83h510M290 280v225m178-225v225" stroke="#d3a174" strokeWidth="12" />
      {[0, 1, 2, 3, 4, 5].map(i => <g key={i} transform={`translate(${145 + (i % 3) * 173} ${292 + Math.floor(i / 3) * 83})`}><rect width="111" height="52" fill={i % 2 ? '#efaa79' : '#a5c7aa'} /><path d="M41 0v52" stroke="#f9e9c8" strokeWidth="13" /><path d="M75 29h20" stroke="#0e1f2e" strokeWidth="3" /></g>)}
      <path d="M55 514h651l-40 55H90Z" fill="#cc9368" /><path d="M90 569v81m577-81v81" stroke="#ce9267" strokeWidth="21" /><rect x="375" y="445" width="146" height="86" fill="#efaa79" /><path d="M435 445v86" stroke="#f9e9c8" strokeWidth="21" />
      <path d="M243 427c-43 12-54 62-46 105h102c-1-42-15-93-56-105Z" fill="#06c4b0" /><circle cx="247" cy="395" r="32" fill="#a75c3f" /><path d="M215 395c-24-41 29-69 57-35l7 26-33-14Z" fill="#132b3e" /><path d="m280 461 54 24 50-12 7 22-61 19-64-20Z" fill="#06c4b0" />
    </> : <>
      <path d="M100 446h570l50 62H64Z" fill="#ce9267" /><path d="M99 508v142m571-142v142" stroke="#ce9267" strokeWidth="26" />
      <path d="M262 435c47-17 92-16 131 0v66c-47-19-87-19-131-4Zm131 0c47-17 92-16 131 0v62c-47-19-87-19-131 4Z" fill="#f6e4bf" /><path d="M393 435v65m-109-44h83m-83 16h83m50-16h83m-83 16h83" stroke="#b58f6b" strokeWidth="3" />
      <path d="M180 439V265l123-80" fill="none" stroke="#0e1f2e" strokeWidth="13" /><path d="m261 184 69-44 58 104-116 3Z" fill="#ffb783" /><path d="M139 437h81" stroke="#0e1f2e" strokeWidth="15" strokeLinecap="round" />
      <path d="M565 441v-98" stroke="#70d3a8" strokeWidth="7" /><path d="M566 393c-72-4-62-66-32-50 34 18 32 50 32 50Zm0-17c-9-69 61-86 61-50s-33 48-61 50Z" fill="#06c4b0" /><path d="m533 407 62 0-10 43h-41Z" fill="#ffb783" />
      <g transform="translate(145 539)"><path d="M0 0h131v31H0Z" fill="#06c4b0" /><path d="M13 31h140v28H13Z" fill="#ffb783" /><path d="M2 59h132v23H2Z" fill="#f6e4bf" /></g>
    </>}
  </svg>;
}
