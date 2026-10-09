export function todayKey(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const get=type=>parts.find(p=>p.type===type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function dayDifference(date,today=todayKey()){return Math.round((Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000)}
export function dueLabel(order,today=todayKey()){
  if(order.status==='sent')return 'გაგზავნილი';
  const days=dayDifference(order.shipDate,today);
  return days===0?'დღეს':days<0?`${Math.abs(days)} დ. დაგვ.`:days===1?'1 დღეში':`${days} დღეში`;
}
export function orderGroups(orders,filter='all',query='',today=todayKey()){
  const q=query.trim().toLocaleLowerCase('ka');
  const matches=orders.filter(o=>!q||[o.customer,o.product,o.phone,o.region,o.address,o.createdBy].some(v=>String(v??'').toLocaleLowerCase('ka').includes(q)));
  const newest=(a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id);
  const pending=matches.filter(o=>o.status==='pending');
  const todayOrders=pending.filter(o=>o.shipDate===today).sort(newest);
  if(filter==='sent')return [{key:'sent',title:'გაგზავნილი შეკვეთები',hint:'ბოლო გაგზავნილი ზემოთ',items:matches.filter(o=>o.status==='sent').sort((a,b)=>(b.sentAt||0)-(a.sentAt||0)||newest(a,b))}];
  if(filter==='today')return [{key:'today',title:'დღეს გასაგზავნი',hint:`${todayOrders.length} შეკვეთა`,items:todayOrders}];
  return [{key:'today',title:'დღეს გასაგზავნი',hint:`${todayOrders.length} შეკვეთა`,items:todayOrders},{key:'other',title:'სხვა შეკვეთები',hint:'ახალი ზემოთ',items:pending.filter(o=>o.shipDate!==today).sort(newest)}].filter(g=>g.items.length);
}
export function money(cents){const whole=Math.floor(cents/100).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ');return whole+(cents%100?','+String(cents%100).padStart(2,'0'):'')+' ₾'}
export function georgianDate(date,{weekday=false,year=false}={}){
  const months=['იანვარი','თებერვალი','მარტი','აპრილი','მაისი','ივნისი','ივლისი','აგვისტო','სექტემბერი','ოქტომბერი','ნოემბერი','დეკემბერი'];
  const weekdays=['კვირა','ორშაბათი','სამშაბათი','ოთხშაბათი','ხუთშაბათი','პარასკევი','შაბათი'];
  const [y,m,d]=date.split('-');return `${Number(d)} ${months[Number(m)-1]}${year?' '+y:''}${weekday?' · '+weekdays[new Date(date+'T12:00:00Z').getUTCDay()]:''}`;
}
export function parsePrice(value){const s=String(value).trim().replace(',','.');if(!/^\d{1,7}(\.\d{1,2})?$/.test(s))throw new Error('ფასი ჩაწერე სწორად, მაგალითად: 85 ან 85.50');return Math.round(Number(s)*100)}
export function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(+d)&&d.toISOString().slice(0,10)===value&&value>='2000-01-01'&&value<='2100-12-31'}
export function validateOrder(input){
  if(!input||typeof input!=='object')throw new Error('შეკვეთის ინფორმაცია არასწორია.');
  const result={};
  for(const [field,label,max] of [['customer','სახელი და გვარი',160],['product','პროდუქტი',500],['region','ქალაქი / რეგიონი',120],['address','ზუსტი მისამართი',1000],['phone','ტელეფონის ნომერი',40]]){
    if(typeof input[field]!=='string'||!input[field].trim()||input[field].trim().length>max)throw new Error(`შეავსე ველი: ${label}`);
    result[field]=input[field].trim();
  }
  const digits=result.phone.replace(/\D/g,'');if(digits.length<9||digits.length>15||!/^\+?[\d\s()\-]+$/.test(result.phone))throw new Error('ტელეფონის ნომერი უნდა შეიცავდეს 9–15 ციფრს.');
  if(!Number.isSafeInteger(input.priceCents)||input.priceCents<0||input.priceCents>999999999)throw new Error('ფასი არასწორია.');result.priceCents=input.priceCents;
  if(!validDate(input.shipDate))throw new Error('აირჩიე სწორი გაგზავნის თარიღი.');result.shipDate=input.shipDate;
  for(const [field,max] of [['deliveryTime',120],['notes',3000]]){if(typeof input[field]!=='string'||input[field].length>max)throw new Error('დამატებითი ინფორმაცია ძალიან გრძელია.');result[field]=input[field].trim();}
  return result;
}
