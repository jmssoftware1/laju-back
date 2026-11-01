import express from 'express';
import bcrypt from 'bcrypt';
import sql from './bd.js';
import {signSession,requireSession} from './session.js';
const router=express.Router();
router.post('/login',async(req,res)=>{
 try{
  const {nome,senha}=req.body||{};
  if(typeof nome!=='string'||typeof senha!=='string'||!nome.trim()||!senha) return res.status(400).json({mensagem:'Informe usuário e senha'});
  const [u]=await sql`SELECT * FROM loja_usuarios WHERE lower(nome)=lower(${nome.trim()}) AND ativo=true`;
  const valid=u&&await bcrypt.compare(senha,u.senha_hash);
  if(!valid) return res.status(401).json({mensagem:'Credenciais inválidas'});
  const operador={id_operador:Number(u.id),nome:u.nome,role:u.role,status:'1'};
  res.json({token:signSession(operador),operador});
 }catch(e){console.error(e);res.status(500).json({mensagem:'Erro ao autenticar'})}
});
router.get('/me',requireSession,async(req,res)=>{
 try{const [u]=await sql`SELECT id,nome,role,ativo FROM loja_usuarios WHERE id=${req.session.id}`;
 if(!u?.ativo)return res.status(401).json({mensagem:'Sessão inválida'});
 res.json({operador:{id_operador:Number(u.id),nome:u.nome,role:u.role,status:'1'}})}catch(e){res.status(500).json({mensagem:'Erro no servidor'})}
});
export default router;
