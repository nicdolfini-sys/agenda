// Safari can scroll/shrink the visual viewport without resizing the layout
// viewport (keyboard, browser bars, orientation). Keep canvas and UI together.
export const viewport=document.querySelector<HTMLElement>('#viewport')!;
let previous='';
export function syncViewport():boolean {
 const visual=window.visualViewport;
 const width=visual?.width||window.innerWidth,height=visual?.height||window.innerHeight;
 const left=visual?.pageLeft??window.scrollX,top=visual?.pageTop??window.scrollY;
 const signature=`${left},${top},${width},${height}`;
 if(signature===previous)return false;
 previous=signature;
 viewport.style.left=`${left}px`;viewport.style.top=`${top}px`;
 viewport.style.width=`${width}px`;viewport.style.height=`${height}px`;
 viewport.dataset.compact=String(height<=480);
 return true;
}
syncViewport();
