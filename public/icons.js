/* Built-in line icons. The pages write icon names such as <span class="material-symbols-outlined">home</span>;
   this swaps each name for an inline SVG, so icons work offline (LAN events) and need no web font download. */
(function(){
  const P={
    home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11.5h4.5v-6h4v6h4.5V9"/>',
    emoji_events:'<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4.5v1A3 3 0 0 0 7.5 10M17 6h2.5v1a3 3 0 0 1-3 3"/><path d="M12 14v3.5M8.5 20.5h7M9.5 17.5h5"/>',
    groups:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17.2" cy="9" r="2.6"/><path d="M16 14.1a5 5 0 0 1 5.2 4.9"/>',
    upload_file:'<path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5z"/><path d="M14 3v4.5h4.5"/><path d="M12 17.5v-6M9.5 14 12 11.5 14.5 14"/>',
    leaderboard:'<path d="M3.5 20.5h17"/><path d="M5 20.5V13h4.5v7.5M9.5 20.5V8.5h5v12M14.5 20.5V11H19v9.5"/>',
    manage_accounts:'<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 9.8-5.6"/><circle cx="18" cy="17" r="2"/><path d="M18 13.5v1.5M18 19v1.5M14.9 15.2l1.3.8M19.8 18l1.3.8M14.9 18.8l1.3-.8M19.8 16l1.3-.8"/>',
    logout:'<path d="M9.5 4H5.5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 16.5 19.5 12 15 7.5M19.5 12H9.5"/>',
    refresh:'<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4.5H15"/>',
    open_in_new:'<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    pause:'<path d="M9 5.5v13M15 5.5v13"/>',
    play_arrow:'<path d="M8 5.5v13l10-6.5z" fill="currentColor"/>',
    visibility:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    visibility_off:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
    arrow_forward:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrow_upward:'<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrow_downward:'<path d="M12 5v14M6 13l6 6 6-6"/>',
    chevron_right:'<path d="M9 6l6 6-6 6"/>',
    lock:'<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    add:'<path d="M12 5v14M5 12h14"/>',
    check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    download:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    delete:'<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 13h9l1-13M9.5 7V4.5h5V7"/>',
    image:'<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>'
  };
  const fallback='<circle cx="12" cy="12" r="3.5"/>';
  function swap(el){
    const name=el.textContent.trim();if(!name)return;
    el.dataset.icon=name;
    el.innerHTML=`<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name]||fallback}</svg>`;
  }
  function scan(root){if(root.matches?.('.material-symbols-outlined'))swap(root);root.querySelectorAll?.('.material-symbols-outlined').forEach(el=>{if(el.textContent.trim())swap(el);});}
  new MutationObserver(records=>{
    for(const record of records){
      const target=record.target;
      if(target.nodeType===1&&target.matches('.material-symbols-outlined')&&target.textContent.trim()){swap(target);continue;}
      record.addedNodes.forEach(node=>{if(node.nodeType===1)scan(node);});
    }
  }).observe(document.documentElement,{childList:true,subtree:true});
  scan(document);
  window.WarIcons={names:Object.keys(P)};
})();
