// Owner-operated, local-only key preparation. Never prints the private key.
import { writeFileSync } from 'node:fs';
const [privatePath,publicPath]=process.argv.slice(2);
if(!privatePath||!publicPath||privatePath===publicPath)throw new Error('Usage: node scripts/create-provider-profile-key.mjs PRIVATE_JWK_FILE PUBLIC_JWK_FILE');
const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const privateJwk=await crypto.subtle.exportKey('jwk',pair.privateKey),publicJwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
writeFileSync(privatePath,JSON.stringify(privateJwk),{flag:'wx',mode:0o600});
writeFileSync(publicPath,JSON.stringify(publicJwk),{flag:'wx',mode:0o600});
console.log('Created owner-only key files. Configure the private JWK only on F|3D and the public JWK only on StreamLion. Do not paste the private JWK into chat or commit it.');
