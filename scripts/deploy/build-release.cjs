const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {parseEnv}=require('node:util');
const config=require('./project.json');
const root=path.resolve(__dirname,'../..'),app=path.join(root,config.app);
const env={...process.env,CI:'true',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--max-old-space-size=6144'};
for(const [key,value] of Object.entries(parseEnv(process.env.BUILD_PUBLIC_ENV||''))){if(!key.startsWith('NEXT_PUBLIC_'))throw Error('BUILD_PUBLIC_ENV may only contain NEXT_PUBLIC_* variables');env[key]=value;}
if(config.kind==='next'&&config.name!=='accountBook'&&!process.env.BUILD_PUBLIC_ENV?.trim())throw Error('Set repository variable BUILD_PUBLIC_ENV before building a deployable release');
function run(command,args,cwd=app){const r=spawnSync(command,args,{cwd,env,stdio:'inherit',shell:process.platform==='win32'});if(r.error||r.status!==0)throw Error('Command failed: '+command+' '+args.join(' '));}
const pnpm=config.name==='health_app';
if(pnpm)run('npm',['install','--global','pnpm@'+JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).packageManager.split('@')[1].split('+')[0]]);
const pm=pnpm?'pnpm':'npm';
run(pm,pnpm?['install','--frozen-lockfile']:['ci']);
if(config.name==='ticket'){run(pm,['test']);run(pm,['run','check']);}
else {
 run(pm,['run',config.name==='health_app'?'test:unit':'test']);
 const scripts=JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).scripts;
 if(scripts['lint:gate'])run(pm,['run','lint:gate']);else if(scripts.lint)run(pm,['run','lint']);
 if(config.name==='accountBook'){
  env.DATABASE_URL='file:'+path.join(app,'initial.db').replaceAll('\\','/');
  run('npx',['prisma','db','push','--skip-generate']);run('npx',['tsx','prisma/seed.ts']);
 }
 run(pm,['exec',...(pnpm?[]:['--']),'next','build']);
 run(pm,['exec',...(pnpm?[]:['--']),'tsc','--noEmit']);
}
const dest=path.join(root,'release');fs.mkdirSync(dest,{recursive:true});
const filter=p=>!path.basename(p).startsWith('.env');
function copy(from,to){if(fs.existsSync(from))fs.cpSync(from,to,{recursive:true,dereference:true,filter});}
if(config.kind==='extension'){
 const extension=path.join(root,'extension-package');fs.mkdirSync(extension,{recursive:true});
 for(const entry of ['manifest.json','dashboard.html','macro.html','icon.png','src'])copy(path.join(app,entry),path.join(extension,entry));
 run('powershell',['-NoProfile','-Command',`Compress-Archive -Path '${extension.replaceAll("'","''")}/*' -DestinationPath '${path.join(dest,'ticket.zip').replaceAll("'","''")}'`],root);
}else{
 const standalone=path.join(app,'.next','standalone');
 if(!fs.existsSync(path.join(standalone,'server.js')))throw Error('Expected standalone/server.js missing; inspect monorepo tracing root');
 copy(standalone,dest);copy(path.join(app,'.next','static'),path.join(dest,'.next','static'));copy(path.join(app,'public'),path.join(dest,'public'));
 if(config.name==='accountBook')copy(path.join(app,'initial.db'),path.join(dest,'initial.db'));
}
fs.writeFileSync(path.join(dest,'release.json'),JSON.stringify({project:config.name,sha:process.env.GITHUB_SHA,builtAt:new Date().toISOString()}));
run('tar',['-cf',path.join(root,'release.tar'),'-C',dest,'.'],root);
