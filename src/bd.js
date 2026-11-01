import postgres from 'postgres';
if(!process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL para o banco novo lajustore');
const sql=postgres(process.env.DATABASE_URL,{max:10,connect_timeout:10,ssl:process.env.DB_SSL==='true'?'require':false});
export default sql;
