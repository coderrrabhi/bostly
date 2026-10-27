const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),assert=require('node:assert/strict');
const pid=cp.execFileSync('pm2',['pid','boostlypro-api'],{encoding:'utf8'}).trim();
const env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(x=>x.includes('=')).map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const rows=JSON.parse(cp.execFileSync('sudo',['-u','postgres','psql','-d','boostlypro_db','-Atc',`SELECT json_agg(t) FROM (SELECT a.id::text,a.email,p.full_name,r.role FROM lovable_legacy.auth_users a JOIN lovable_legacy.profiles p ON p.user_id=a.id JOIN lovable_legacy.user_roles r ON r.user_id=a.id WHERE r.role='admin' UNION ALL SELECT a.id::text,a.email,p.full_name,r.role FROM lovable_legacy.auth_users a JOIN lovable_legacy.profiles p ON p.user_id=a.id JOIN lovable_legacy.user_roles r ON r.user_id=a.id WHERE r.role='user' AND p.full_name<>'' LIMIT 2) t`],{encoding:'utf8'}));
(async()=>{
 const sessions=[];
 for(const row of rows){const payload=Buffer.from(JSON.stringify({uid:row.id,exp:Date.now()+600000})).toString('base64url');const sig=crypto.createHmac('sha256',env.SESSION_SECRET).update(payload).digest('base64url');const cookie=payload+'.'+sig;const headers={cookie:'boostly_session='+cookie};
 const r=await fetch('http://127.0.0.1:'+env.PORT+'/api/session',{headers});assert.equal(r.status,200);const b=await r.json();assert.equal(b.role,row.role);assert.equal(b.profile.email,row.email);assert.equal(b.profile.fullName,row.full_name);assert.equal(b.profile.userId,row.id);
 const admin=await fetch('http://127.0.0.1:'+env.PORT+'/api/functions/admin-provider-accounts',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({op:'list'})});assert.equal(admin.status,row.role==='admin'?200:403);
 sessions.push({role:row.role,email:row.email,name:row.full_name,cookie});console.log(row.role+' identity and admin access assertions passed');
 }
 const denied=await fetch('http://127.0.0.1:'+env.PORT+'/api/session');assert.equal(denied.status,401);
 if(process.argv.includes('--browser'))fs.writeFileSync('/tmp/boostly-browser-sessions.json',JSON.stringify(sessions),{mode:0o600});
})().catch(e=>{console.error(e.name,e.message.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,'[private]'));process.exit(1)});
