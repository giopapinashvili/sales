import {createECDH} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
const password=await readFile('.initial-password','utf8').then(value=>value.trim()).catch(()=>'local-test-123');
const passwordLine='APP_PASSWORD='+JSON.stringify(password);
try{const existing=await readFile('.dev.vars','utf8');const updated=/^APP_PASSWORD=.*$/m.test(existing)?existing.replace(/^APP_PASSWORD=.*$/m,passwordLine):existing+'\n'+passwordLine+'\n';if(updated!==existing)await writeFile('.dev.vars',updated);process.stdout.write('Local configuration ready.\n')}catch{const ecdh=createECDH('prime256v1');ecdh.generateKeys();await writeFile('.dev.vars',`${passwordLine}\nVAPID_PUBLIC_KEY="${ecdh.getPublicKey().toString('base64url')}"\nVAPID_PRIVATE_KEY="${ecdh.getPrivateKey().toString('base64url')}"\nVAPID_SUBJECT="mailto:local-test@example.com"\n`);process.stdout.write('Local test configuration prepared.\n')}
