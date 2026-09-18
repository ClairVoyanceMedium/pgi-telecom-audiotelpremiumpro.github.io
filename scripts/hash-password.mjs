import {hashPassword} from "../backend/src/security.mjs";
const password=process.argv[2];
if(!password){
  console.error("Usage: node scripts/hash-password.mjs '<strong-password>'");
  process.exit(64);
}
console.log(hashPassword(password));
