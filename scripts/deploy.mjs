import {spawn} from 'node:child_process';
import {createECDH} from 'node:crypto';
import {readFile,writeFile,access,unlink} from 'node:fs/promises';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
const wrangler='node_modules/wrangler/bin/wrangler.js';
function run(args,input){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[wrangler,...args],{stdio:[input===undefined?'inherit':'pipe','inherit','inherit'],env:{...process.env,WRANGLER_SEND_METRICS:'false'}});if(input!==undefined)child.stdin.end(input);child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('მოქმედება შეწყდა. შეცდომა ზემოთაა; გამოსწორების შემდეგ ხელახლა გაუშვი npm run deploy.')))})}
async function question(text,hidden=false){const output=new Writable({write(chunk,encoding,cb){if(!output.muted)process.stdout.write(chunk);cb()}});const rl=createInterface({input:process.stdin,output,terminal:process.stdin.isTTY});try{if(hidden){process.stdout.write(text);output.muted=true;const value=await rl.question('');output.muted=false;process.stdout.write('\n');return value}return await rl.question(text)}finally{rl.close()}}
async function main(){
  await access('public/icons/icon-512.png');
  let config=JSON.parse(await readFile('wrangler.json','utf8'));
  const presetPassword=await readFile('.initial-password','utf8').then(value=>value.trim()).catch(()=>null);
  let secrets;try{secrets=JSON.parse(await readFile('deployment-secrets.json','utf8'))}catch{}
  if(secrets&&presetPassword&&secrets.APP_PASSWORD!==presetPassword){secrets.APP_PASSWORD=presetPassword;await writeFile('deployment-secrets.json',JSON.stringify(secrets,null,2));}
  if(!secrets){
    process.stdout.write('\nშეკვეთების რვეული — Cloudflare-ზე გამართვა\n');
    const name=(await question(`საიტის მოკლე სახელი [${config.name}]: `)).trim()||config.name;if(!/^[a-z][a-z0-9-]{2,50}$/.test(name))throw new Error('სახელი ჩაწერე ლათინური პატარა ასოებით, ციფრებით და ტირეთი.');config.name=name;
    const password=presetPassword||await question('მაღაზიის პაროლი (მინ. 8 სიმბოლო, აკრეფა არ ჩანს): ',true);if(password.length<8||password.length>128)throw new Error('პაროლი უნდა შეიცავდეს 8–128 სიმბოლოს.');if(!presetPassword){const repeat=await question('გაიმეორე პაროლი: ',true);if(password!==repeat)throw new Error('პაროლები არ ემთხვევა.');}
    const contact=(await question('შენი ელფოსტა (შეტყობინების სერვისის საკონტაქტოდ): ')).trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))throw new Error('ელფოსტა სწორად ჩაწერე.');
    const key=createECDH('prime256v1');key.generateKeys();secrets={APP_PASSWORD:password,VAPID_PUBLIC_KEY:key.getPublicKey().toString('base64url'),VAPID_PRIVATE_KEY:key.getPrivateKey().toString('base64url'),VAPID_SUBJECT:'mailto:'+contact};await writeFile('deployment-secrets.json',JSON.stringify(secrets,null,2));await writeFile('wrangler.json',JSON.stringify(config,null,2)+'\n');
  }
  process.stdout.write('\nშეამოწმე, რომ Cloudflare-ში შენს ანგარიშზე შედიხარ.\n');await run(['login']);await run(['whoami']);
  let db=config.d1_databases?.find(v=>v.binding==='DB');
  if(!db||db.database_id==='00000000-0000-0000-0000-000000000000'){
    await run(['d1','create',config.name+'-db','--binding','DB','--update-config','--location','eeur']);
    config=JSON.parse(await readFile('wrangler.json','utf8'));db=config.d1_databases.find(v=>v.binding==='DB');if(!db?.database_id)throw new Error('საცავი ვერ მიება. გადახედე Cloudflare-ის პასუხს.');db.migrations_dir='migrations';await writeFile('wrangler.json',JSON.stringify(config,null,2)+'\n');
  }
  await run(['d1','migrations','apply','DB','--remote']);
  await run(['deploy','--secrets-file','deployment-secrets.json']);
  await unlink('.initial-password').catch(error=>{if(error.code!=='ENOENT')throw error;});
  process.stdout.write('\nმზადაა! გახსენი ზემოთ ნაჩვენები მისამართი.\nშედი შენს პაროლით, დაამატე აპი ტელეფონში და ზარის ღილაკით ჩართე შეხსენება.\nპაროლი და გასაღებები deployment-secrets.json-შია — შეინახე პირადად.\n');
}
main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1});
