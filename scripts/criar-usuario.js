import 'dotenv/config';
import bcrypt from 'bcrypt';
import sql from '../src/bd.js';
const [nome,senha,role='gestor']=process.argv.slice(2);
if(!nome||!senha||senha.length<10||!['gestor','funcionario'].includes(role)){
 console.error('Uso: npm run criar-usuario -- "Nome" "senha-com-10-ou-mais-caracteres" [gestor|funcionario]');process.exit(1);
}
try{const hash=await bcrypt.hash(senha,12);await sql`INSERT INTO loja_usuarios(nome,senha_hash,role) VALUES(${nome},${hash},${role})`;
console.log('Usuário criado:',nome,role)}catch(e){console.error(e.message);process.exitCode=1}finally{await sql.end()}
