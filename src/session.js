import { createHmac, timingSafeEqual } from "node:crypto";
const secret = process.env.SESSION_SECRET;
export function signSession(op) {
 if (!secret || secret.length < 32) throw Error("SESSION_SECRET deve ter pelo menos 32 caracteres");
 const payload=Buffer.from(JSON.stringify({id:op.id_operador, role:op.role,exp:Date.now()+8*3600_000})).toString("base64url");
 const sig=createHmac("sha256",secret).update(payload).digest("base64url");
 return `${payload}.${sig}`;
}
export function requireSession(req,res,next){
 const token=(req.headers.authorization||"").replace(/^Bearer /i, "");
 const [payload,sig]=token.split(".");
 if(!secret || !payload || !sig) return res.status(401).json({mensagem:"Sessão obrigatória"});
 const expected=createHmac("sha256",secret).update(payload).digest();
 let provided;
 try{ provided=Buffer.from(sig,"base64url"); }catch{return res.status(401).json({mensagem:"Sessão inválida"});}
 if(expected.length!==provided.length || !timingSafeEqual(expected,provided)) return res.status(401).json({mensagem:"Sessão inválida"});
 try{const data=JSON.parse(Buffer.from(payload,"base64url").toString()); if(data.exp<Date.now() || !Number.isInteger(data.id)) throw Error();req.session=data;next();}
 catch{return res.status(401).json({mensagem:"Sessão expirada ou inválida"});}
}
