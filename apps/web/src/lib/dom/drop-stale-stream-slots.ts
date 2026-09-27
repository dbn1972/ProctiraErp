/**
 * Next.js streams the server-rendered page into a hidden suspense slot
 * (`<div hidden id="S:…">`) and then reveals that markup into the visible
 * shell. On `next start`, the slot is sometimes left in the document after
 * the visible copy is already mounted — mobile and tablet more often than
 * desktop, because the shell swap happens while the stream is still open.
 *
 * The leftover is `hidden`, so it is absent from the accessibility tree and
 * from screenshots, but `getByTestId` / `querySelector` still match it.
 * Playwright then fails strict mode ("resolved to 2 elements") on locators
 * that are unique in the visible page. A stuck slot also wedges the App
 * Router transition that was going to reveal it, so a click can leave the
 * URL on the previous route.
 *
 * The script runs at the end of `<body>`, before `DOMContentLoaded`, and
 * keeps watching so a later client navigation cannot leave another copy.
 * A slot is removed only when every `data-testid` inside it already exists
 * outside it. A partial reveal (Next still copying nodes out of the slot)
 * is left alone so the rest of the payload is not discarded.
 */
export const DROP_STALE_STREAM_SLOTS_SCRIPT = `(function(){
  function revealed(slot){
    if(!window.CSS||!CSS.escape)return false;
    var probes=slot.querySelectorAll("[data-testid]");
    if(!probes.length)return false;
    for(var p=0;p<probes.length;p++){
      var id=probes[p].getAttribute("data-testid");
      if(!id)return false;
      var nodes=document.querySelectorAll('[data-testid="'+CSS.escape(id)+'"]');
      var outside=false;
      for(var i=0;i<nodes.length;i++){
        if(!slot.contains(nodes[i])){outside=true;break;}
      }
      if(!outside)return false;
    }
    return true;
  }
  function drop(){
    var slots=document.querySelectorAll('div[hidden][id^="S:"]');
    for(var i=0;i<slots.length;i++){
      if(revealed(slots[i]))slots[i].remove();
    }
  }
  drop();
  new MutationObserver(drop).observe(document.documentElement,{childList:true,subtree:true});
})();`;
