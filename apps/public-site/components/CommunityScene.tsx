type Scene = 'garden' | 'pantry' | 'reading';

const descriptions = {
  garden: 'Original illustration of two people planting and watering a shared garden bed',
  pantry: 'Original illustration of a person packing a box beside shelves of pantry supplies',
  reading: 'Original illustration of an open book and reading materials on a sunlit desk',
};

/** Original fictional scenes. No real person, place, organizer, or partner is depicted. */
export function CommunityScene({ scene = 'garden', className = '', crop = 'full', decorative = false }: {
  scene?: Scene; className?: string; crop?: 'full' | 'wide'; decorative?: boolean;
}) {
  return <svg className={`community-scene scene-${scene} ${className}`} viewBox={crop === 'wide' ? '0 105 760 455' : '0 0 760 560'}
    role={decorative ? undefined : 'img'} aria-hidden={decorative || undefined} aria-label={decorative ? undefined : descriptions[scene]}>
    <rect width="760" height="560" fill="#e9f4f5" />
    {scene === 'garden' ? <>
      <circle cx="604" cy="107" r="67" fill="#ffcf94" />
      <path d="M19 270V241h48v-42h75v73h44v-59h63v55h44v-90h84v86h40v-48h61v52h40v-69h91v70h37v-39h67v42h47v288H0V270Z" fill="#b5d9e1" />
      <path d="M0 302c171-45 337 21 480-8s204-22 280-38v304H0Z" fill="#8bbcb0" />
      <path d="M0 409c174-87 319 15 478-52s214-51 282-56v259H0Z" fill="#386b60" />
      <path d="M-18 536c187-76 280-25 448-38s240-58 353-27" fill="none" stroke="#d4d8ba" strokeWidth="66" />
      <g fill="none" stroke="#769a87" strokeWidth="3"><path d="M0 313h760M0 342h760" /><path d="M45 293v68m76-66v70m76-67v69m76-69v70m76-72v73m76-75v70m76-84v78m76-88v80m76-90v79m76-92v80" /></g>
      <g fill="#fff" opacity=".8"><rect x="79" y="100" width="93" height="7" rx="3.5" /><rect x="101" y="86" width="46" height="6" rx="3" /><rect x="362" y="61" width="95" height="7" rx="3.5" /></g>
      <g transform="translate(690 249)"><path d="M0 0v194" fill="none" stroke="#305b4e" strokeWidth="7" /><path d="M0 55c-50-7-62-57-35-61S6 21 0 55Zm0 44c3-47 51-74 58-46s-21 54-58 46Zm0 37c-51-1-60-43-36-48S0 110 0 136Z" fill="#73b5a0" /></g>
      {/* Kneeling gardener, with complete grounded legs and connected hands. */}
      <path d="m203 413-43 61 15 34 49-48 24 43 49-9-2-23-36 2-15-65Z" fill="#173b50" /><path d="m158 473-18 15c-9 9-10 18 2 22h34l-1-17Zm88 28-2 16h65c4-12-4-20-17-23Z" fill="#d9d8c6" />
      <path d="M196 318c-25 20-33 57-14 93 18 21 52 23 77 0l-12-68Z" fill="#ee896c" /><path d="m225 336 34 41 51 20-7 16-67-19-33-38Z" fill="#ee896c" /><path d="m305 396 24 7c9 3 7 14-2 15l-24-5Z" fill="#ae6a4a" /><path d="m193 344-14 45 29 35 12-10-21-31 18-33Z" fill="#ae6a4a" /><path d="m207 417 15 4 10 15c-5 8-11 8-16 1l-10-11Z" fill="#ae6a4a" />
      <path d="m206 320-1-23 30-7 4 39" fill="#ae6a4a" /><ellipse cx="224" cy="287" rx="27" ry="33" fill="#ae6a4a" transform="rotate(12 224 287)" /><path d="M196 289c-14-25-2-48 24-49 30-1 43 20 33 39l-14-16c-12 14-29 13-43 26Z" fill="#163243" /><path d="m239 287 6 2m-5 13-7 1" fill="none" stroke="#593e34" strokeWidth="2" strokeLinecap="round" /><path d="m187 379 8 25m36-58 6 11" fill="none" stroke="#c56856" strokeWidth="2.5" strokeLinecap="round" />
      {/* Watering partner: a visible can and water directed toward the plants. */}
      <path d="m547 334-7 102 28 38 18-11-19-40 18-64 22 67-3 44 23 3 10-60-20-87Z" fill="#174a54" /><path d="m563 466-17 9-13 10c-4 5 1 10 8 10h31l13-19Zm42 1-7 23h43c4-10-2-18-15-20Z" fill="#d9d8c6" />
      <path d="M561 232c-27 25-28 65-20 106 25 21 58 18 85-5l-14-85Z" fill="#f5d28b" /><path d="m567 250-21 44-39 24 9 16 51-26 26-43" fill="#f5d28b" /><path d="m508 318-19 9c-10 5-5 16 4 14l23-8Z" fill="#c68b60" /><path d="m610 259 24 38-15 32-14-7 9-27-23-29" fill="#c68b60" />
      <path d="M574 236v-25h30v28" fill="#c68b60" /><ellipse cx="586" cy="196" rx="26" ry="32" fill="#c68b60" transform="rotate(-9 586 196)" /><path d="M559 200c-15-36 16-56 39-40 16 3 22 21 14 36l-13-19-40 23Z" fill="#253d38" /><circle cx="611" cy="160" r="15" fill="#253d38" /><path d="m571 199 5-1m-2 15 7 1" fill="none" stroke="#77513c" strokeWidth="2" strokeLinecap="round" /><path d="m551 322 13 6m37-65 7 11" fill="none" stroke="#d4aa67" strokeWidth="2.5" strokeLinecap="round" />
      {/* The shared bed connects both tasks. */}
      <path d="m288 410 322-21 72 50-318 29Z" fill="#c28d66" /><path d="m364 468 318-29v70l-318 29Z" fill="#ce9a75" /><path d="m288 410 76 58v70l-76-59Z" fill="#a4704d" /><path d="m308 411 297-17 51 36-289 24Z" fill="#3e3d2e" /><path d="m377 482 288-25m-288 34 288-26" fill="none" stroke="#b7835e" strokeWidth="2" />
      <g fill="#95bc75"><path d="M373 437c-37-7-27-33-8-21-4-35 30-35 20-10 37-9 32 21 5 27Z" /><path d="M470 430c-38-9-28-35-7-23-3-34 31-32 20-8 36-8 31 22 5 27Z" /><path d="M570 422c-34-7-27-32-8-21-4-32 29-31 20-8 31-6 28 22 4 24Z" /></g>
      <g fill="none" stroke="#537b4c" strokeWidth="2" strokeLinecap="round"><path d="m377 433 1-20m94 13 2-19m97 11 2-19" /></g>
      <g transform="rotate(-17 484 355)"><path d="M468 328h39v46h-39Z" fill="#0a8780" /><path d="M476 329v-13c0-15 24-15 24 0v13" fill="none" stroke="#086e68" strokeWidth="6" /><path d="m469 350-29-19-4 8 32 27" fill="#0a8780" /><path d="m441 331-8 7" stroke="#d2e9e0" strokeWidth="6" strokeLinecap="round" /></g>
      <g stroke="#b3dce2" strokeWidth="2" strokeLinecap="round"><path d="m436 352-10 18m5-15-12 17m20-14-7 17" /></g>
      <g transform="translate(68 434)"><path d="m0 27 47 0-6 40H8Z" fill="#c28d66" /><path d="M23 29V-8" stroke="#346d52" strokeWidth="4" /><path d="M23 10C-3 9-8-14 4-15S24 0 23 10Zm0 9c4-30 30-30 30-17s-15 20-30 17Z" fill="#77aa72" /></g><path d="m339 427-8 7 12 5" fill="none" stroke="#c7a575" strokeWidth="3" strokeLinecap="round" />
    </> : scene === 'pantry' ? <>
      <rect y="348" width="760" height="212" fill="#d3ddd0" /><rect x="71" y="69" width="173" height="203" rx="3" fill="#a4d8ef" /><circle cx="196" cy="125" r="34" fill="#ffd49b" /><path d="M75 214h167v54H75Z" fill="#79b2ba" /><path d="M157 72v197m-84-98h169" stroke="#f8f7f2" strokeWidth="8" />
      <rect x="363" y="113" width="319" height="267" fill="#e4c5a2" /><rect x="377" y="128" width="291" height="239" fill="#42635e" /><path d="M377 207h291m-291 81h291m-145-160v240" stroke="#c28d66" strokeWidth="10" />
      {[0, 1, 2, 3, 4, 5].map(i => <g key={i} transform={`translate(${394 + (i % 2) * 148} ${144 + Math.floor(i / 2) * 80})`}><rect width="106" height="53" rx="2" fill={i % 2 ? '#dcaa7e' : '#95b9a4'} /><path d="M40 0v53" stroke="#efdfbb" strokeWidth="13" /><path d="M72 29h20" stroke="#46635c" strokeWidth="2" /></g>)}
      <path d="m200 371-18 122 27 0 25-87 21 86h28l-13-127Z" fill="#173b50" /><path d="m180 488-15 25h45l2-24Zm72 0 1 25h46c2-10-8-17-17-23Z" fill="#d9d8c6" />
      <path d="M208 246c-32 19-35 80-19 127 28 19 60 20 88-2l-13-108Z" fill="#0c958a" /><path d="m238 273 34 47 60 21-7 20-75-21-34-46Z" fill="#0c958a" /><path d="m329 341 27 8c9 3 8 14-2 15l-29-3Z" fill="#a76a4d" /><path d="m199 277-22 43 20 33 17-8-11-27 22-30" fill="#a76a4d" />
      <path d="M216 251v-25h31v34" fill="#a76a4d" /><ellipse cx="232" cy="211" rx="27" ry="34" fill="#a76a4d" /><path d="M205 216c-23-37 7-60 36-47 22 9 27 33 17 46l-11-29c-12 13-25 16-42 30Z" fill="#163243" /><path d="m245 211 5 1m-6 14-7 1" stroke="#593e34" strokeWidth="2" strokeLinecap="round" />
      <path d="M110 386h550l38 34H84Z" fill="#d5ad84" /><path d="M111 420v140m545-140v140" stroke="#bc8d66" strokeWidth="17" />
      <path d="m328 327 118-8 44 27-121 14Z" fill="#e7c59f" /><path d="m369 360 121-14v59l-121 12Z" fill="#d3a377" /><path d="m328 327 41 33v57l-41-30Z" fill="#bb8a5f" /><path d="m348 325 96-4 24 19-99 11Z" fill="#667f67" /><path d="m370 354 34-28m26 24-23-25" stroke="#efdfbb" strokeWidth="8" /><path d="m444 319 21-29 48 26-23 30m-162-19-21-21 25-23 36 40" fill="#e0b88f" />
      <g transform="translate(539 343)"><rect width="34" height="43" rx="5" fill="#bd7560" /><path d="M4 0h26v7H4Z" fill="#e6ce9e" /><rect x="42" y="6" width="34" height="37" rx="4" fill="#7eaa98" /><path d="M47 6h24v6H47Z" fill="#f2dba9" /></g>
    </> : <>
      <rect x="407" y="51" width="239" height="237" rx="5" fill="#a4d8ef" /><circle cx="594" cy="109" r="37" fill="#ffd49b" /><path d="M410 218c64-35 129-5 234-44v111H410Z" fill="#92bca8" /><path d="M527 55v230m-118-111h234" stroke="#f8f7f2" strokeWidth="9" />
      <path d="M0 371h760v189H0Z" fill="#d8dfd1" /><path d="m93 351 515-11 70 78-602 15Z" fill="#d0a176" /><path d="M109 433v127m501-137v137" stroke="#b48360" strokeWidth="23" />
      <path d="M251 381c55-17 101-14 141 4v55c-44-15-94-16-141-4Z" fill="#f7e8c8" /><path d="M392 385c39-19 88-24 139-12v54c-47-8-96-4-139 13Z" fill="#fff4d8" /><path d="M392 385v55m-117-40h88m-88 11h88m-88 11h64m66-24 92-9m-92 20 92-9m-92 20 70-7" fill="none" stroke="#b39770" strokeWidth="2" />
      <path d="M157 363V219l115-77" fill="none" stroke="#173b50" strokeWidth="10" strokeLinejoin="round" /><circle cx="157" cy="219" r="9" fill="#173b50" /><path d="m238 146 58-37 49 88-98 5Z" fill="#ee9a76" /><path d="M123 363h72" stroke="#173b50" strokeWidth="12" strokeLinecap="round" />
      <g transform="translate(533 334)"><path d="M18 0v-95" stroke="#3c785e" strokeWidth="5" /><path d="M18-50c-43-3-43-41-22-37s23 21 22 37Zm0-16c0-45 42-53 43-29s-23 32-43 29Z" fill="#4b9c80" /><path d="m-8-10 55 0-10 47H2Z" fill="#df9d76" /></g>
      <g transform="translate(179 445)"><path d="M0 0h150v22H0Z" fill="#148a85" /><path d="M10 22h151v25H10Z" fill="#e69a76" /><path d="M1 47h150v21H1Z" fill="#e8cc92" /><path d="M14 28h136m-136 7h136" stroke="#f2dfbf" strokeWidth="2" /></g>
      <path d="m461 464 79-5 7 47-80 5Z" fill="#f8f0da" /><path d="m473 475 48-3m-47 12 54-3m-54 12 37-2" stroke="#93a89b" strokeWidth="2" /><path d="m552 466 22 35" stroke="#0e6289" strokeWidth="5" strokeLinecap="round" /><path d="M72 475c-13-63-49-65-65-36v121h68Z" fill="#386b60" />
    </>}
  </svg>;
}
