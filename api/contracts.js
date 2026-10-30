// Vercel Serverless Function: server-to-server Google Sheets private reader.
// Required env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, PANEL_ACCESS_TOKEN
import { createSign, timingSafeEqual } from 'node:crypto';

const SHEET_ID='1--1SR3M68rc9YEU-Jj3_mMUQfHDSqVwG';
const b64=(v)=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function error(res,status,message){res.status(status).json({error:message});}
function authorized(incoming,expected){
 if(!incoming||!expected)return false;
 const provided=incoming.startsWith('Bearer ')?incoming.slice(7):'';
 const a=Buffer.from(provided),b=Buffer.from(expected);
 return a.length===b.length && timingSafeEqual(a,b);
}
async function googleToken(email,privateKey){
 const now=Math.floor(Date.now()/1000);
 const header=b64({alg:'RS256',typ:'JWT'});
 const body=b64({iss:email,scope:'https://www.googleapis.com/auth/spreadsheets.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const content=header+'.'+body;
 const sig=createSign('RSA-SHA256').update(content).end().sign(privateKey.replace(/\\n/g,'\n'),'base64url');
 const auth=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:content+'.'+sig})
 });
 const result=await auth.json();
 if(!auth.ok)throw Error('Google OAuth: '+(result.error_description||result.error||auth.status));
 return result.access_token;
}
async function getJSON(url,token){
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 const j=await r.json();if(!r.ok)throw Error(j.error?.message||'Google Sheets HTTP '+r.status);return j;
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return error(res,405,'Mètode no permès');
 if(!process.env.PANEL_ACCESS_TOKEN||!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL||!process.env.GOOGLE_PRIVATE_KEY)
   return error(res,503,'Falta configurar l’accés privat a Google Sheets a Vercel');
 if(!authorized(req.headers.authorization||'',process.env.PANEL_ACCESS_TOKEN))
   return error(res,401,'Accés no autoritzat');
 try{
  const token=await googleToken(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,process.env.GOOGLE_PRIVATE_KEY);
  const meta=await getJSON('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(SHEET_ID)+'?fields=sheets(properties(title,sheetId,gridProperties))',token);
  const sheets=meta.sheets||[];
  const chosen=sheets.find(s=>s.properties.title.trim().toLowerCase()==='contratos')||sheets.find(s=>s.properties.title.trim().toLowerCase()==='contractes');
  if(!chosen)throw Error('No s’ha trobat una pestanya anomenada Contratos o Contractes');
  const title=chosen.properties.title;
  const range="'"+title.replace(/'/g,"''")+"'!A:ZZ";
  const data=await getJSON('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(SHEET_ID)+'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMATTED_VALUE',token);
  const rows=data.values||[];
  if(!rows.length)throw Error('La pestanya seleccionada és buida');
  res.status(200).json({rows,sheet:title,updatedAt:new Date().toISOString(),count:rows.length-1});
 }catch(e){console.error('Sheets read failure:',e.message);return error(res,502,e.message)}
}
