const LATER_KEY='orders-install-later';
const INSTALLED_KEY='orders-app-installed';
const WEEK=7*86400000;
const stored=key=>{try{return localStorage.getItem(key)}catch{return null}};
const remember=(key,value)=>{try{value===null?localStorage.removeItem(key):localStorage.setItem(key,value)}catch{}};
export function installEnvironment(){
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  return {ios,mobile:ios||Boolean(navigator.userAgentData?.mobile)||/Android/i.test(navigator.userAgent),standalone:matchMedia('(display-mode: standalone)').matches||Boolean(navigator.standalone)};
}
export function setupInstall({ready,notify}){
  const dialog=document.getElementById('install-dialog'),button=document.getElementById('install-now'),steps=document.getElementById('install-steps'),note=document.getElementById('install-note');
  let deferred=null,offered=false,installing=false,timer;
  const installed=()=>installEnvironment().standalone||stored(INSTALLED_KEY)==='yes';
  const later=()=>remember(LATER_KEY,String(Date.now()+WEEK));
  function render(){
    const {ios}=installEnvironment();
    button.hidden=!deferred||installed();button.disabled=installing;
    steps.hidden=Boolean(deferred);
    note.textContent=deferred?'დააჭირე ქვემოთ და შემდეგ დაადასტურე დაყენება.':ios?'iPhone-ზე აპის დამატება Safari-დან შეგიძლია.':'აპის დამატება ბრაუზერის მენიუდანაც შეგიძლია.';
    steps.innerHTML=ios?'<li>Safari-ში დააჭირე <strong>გაზიარებას (Share)</strong>.</li><li>აირჩიე <strong>მთავარ ეკრანზე დამატება (Add to Home Screen)</strong>. თუ ჩანს „Open as Web App“, ჩართული დატოვე.</li><li>დააჭირე <strong>დამატებას (Add)</strong> და აპი მთავარი ეკრანიდან გახსენი.</li>':'<li>Chrome-ში გახსენი მენიუ <strong>⋮</strong>.</li><li>აირჩიე <strong>აპის დაყენება (Install app)</strong> ან <strong>მთავარ ეკრანზე დამატება (Add to Home screen)</strong>.</li><li>დაადასტურე და აპი მთავარი ეკრანიდან გახსენი.</li>';
  }
  function open(){
    if(installed()){notify('აპი უკვე დაყენებულია. გახსენი მთავარი ეკრანიდან.');return}
    if(!ready())return;
    document.getElementById('settings-dialog').close();
    if(document.querySelector('dialog[open]'))return;
    offered=true;render();dialog.showModal();
  }
  function consider(){
    clearTimeout(timer);
    if(offered||!ready()||!installEnvironment().mobile||installed()||Number(stored(LATER_KEY))>Date.now())return;
    timer=setTimeout(()=>{if(document.visibilityState==='visible'&&!document.querySelector('dialog[open]'))open()},750);
  }
  async function request(){
    if(!deferred||installing)return;
    const prompt=deferred;deferred=null;installing=true;button.disabled=true;
    try{
      // Keep the browser prompt in the button's user gesture; each event is usable once.
      const prompted=await prompt.prompt(),choice=prompt.userChoice?await prompt.userChoice:prompted;
      if(choice?.outcome==='accepted'){remember(INSTALLED_KEY,'yes');dialog.close();notify('აპის დაყენება დადასტურებულია. გახსენი მთავარი ეკრანიდან.')}else{later();dialog.close()}
    }catch{notify('გამოიყენე ქვემოთ მოცემული დაყენების ინსტრუქცია.',true)}finally{installing=false;render()}
  }
  button.addEventListener('click',request);
  dialog.addEventListener('close',()=>{if(!installed())later()});
  document.addEventListener('close',event=>{if(event.target!==dialog)consider()},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')consider()});
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;remember(INSTALLED_KEY,null);if(dialog.open)render();consider()});
  window.addEventListener('appinstalled',()=>{deferred=null;remember(INSTALLED_KEY,'yes');remember(LATER_KEY,null);if(dialog.open)dialog.close();notify('აპი დაემატა მთავარ ეკრანზე')});
  const displayMode=matchMedia('(display-mode: standalone)');
  displayMode.addEventListener('change',()=>{if(installed()){if(dialog.open)dialog.close()}else consider()});
  if(installEnvironment().standalone)remember(INSTALLED_KEY,'yes');
  return {consider,open};
}
