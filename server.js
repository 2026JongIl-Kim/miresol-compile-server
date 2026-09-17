const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000; // 클라우드 배포 시 플랫폼이 PORT 환경변수로 포트를 지정해줌
// 주의: /api/upload(실제 하드웨어에 업로드까지 하는 위험한 작업)는 CORS를 켜지 않음.
// 프론트(index.html)와 이 서버가 같은 오리진일 때(로컬 실행형)만 호출 가능하게 유지.
app.use(express.json({limit:'1mb'}));
app.use(express.static(__dirname));

function run(command,args){
  return new Promise((resolve,reject)=>{
    const p=spawn(command,args,{windowsHide:true}); let out='',err='';
    const timer=setTimeout(()=>{ try{p.kill();}catch(e){} reject(new Error('명령 실행 시간 초과: '+command+' '+args.join(' ')));},120000);
    p.stdout.on('data',d=>out+=d); p.stderr.on('data',d=>err+=d);
    p.on('error',e=>{clearTimeout(timer);reject(e);});
    p.on('close',code=>{clearTimeout(timer); code===0?resolve({out,err}):reject(new Error(err||out||`exit ${code}`));});
  });
}
async function cli(){
  for(const c of process.platform==='win32'?['arduino-cli.exe','arduino-cli']:['arduino-cli']){
    try{await run(c,['version']); return c;}catch(e){}
  } return null;
}
const allowed=new Set(['arduino:avr:uno','arduino:avr:nano','esp32:esp32:esp32','esp32:esp32:esp32s3']);
function board(v){if(!allowed.has(v))throw new Error('지원하지 않는 보드: '+v);return v;}

app.get('/api/status',async(req,res)=>res.json({success:true,arduinoCli:!!(await cli())}));

app.get('/api/ports',async(req,res)=>{
  try{const c=await cli(); if(!c)throw new Error('arduino-cli를 찾지 못했습니다.');
    const r=await run(c,['board','list','--format','json']);
    const d=JSON.parse(r.out); const ports=(d.detected_ports||[]).map(x=>({address:x.port?.address||x.port?.label||'',boardName:x.matching_boards?.[0]?.name||'',fqbn:x.matching_boards?.[0]?.fqbn||''})).filter(x=>x.address);
    res.json({success:true,ports});
  }catch(e){res.status(500).json({success:false,message:e.message});}
});

// ── 컴파일 전용 API (브로콜리 코딩 방식 벤치마킹) ──────────
// 하드웨어에 직접 접근하지 않고 컴파일만 하므로, 다른 도메인(예: GitHub Pages에
// 올라간 index.html)에서도 호출 가능하게 이 라우트에만 cors()를 허용한다.
// 실제 업로드는 여기서 돌려준 .hex를 브라우저가 avrgirl-arduino로 직접 굽는다.
app.post('/api/compile', cors(), async (req, res) => {
  const { code } = req.body; let fqbn;
  try{fqbn=board(req.body.board||'arduino:avr:uno');}catch(e){return res.status(400).json({success:false,message:e.message});}
  if(!code)return res.status(400).json({success:false,message:'코드가 없습니다.'});
  const c=await cli(); if(!c)return res.status(500).json({success:false,message:'arduino-cli를 찾지 못했습니다. PATH를 확인하세요.'});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'miresol-'));
  const sketch=path.join(dir,'MiresolSketch');
  fs.mkdirSync(sketch);
  fs.writeFileSync(path.join(sketch,'MiresolSketch.ino'),code,'utf8');
  const outDir = path.join(dir, 'build');
  fs.mkdirSync(outDir);
  try{
    await run(c,['compile','--fqbn',fqbn,'--output-dir',outDir,sketch]);
    const hexPath = path.join(outDir, 'MiresolSketch.ino.hex');
    if (!fs.existsSync(hexPath)) throw new Error('컴파일은 됐지만 hex 파일을 찾지 못했습니다. (보드 종류 확인 필요)');
    const hexBuffer = fs.readFileSync(hexPath);
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(hexBuffer);
  }catch(e){res.status(500).json({success:false,message:e.message});}
  finally{try{fs.rmSync(dir,{recursive:true,force:true});}catch(e){}}
});

app.post('/api/upload',async(req,res)=>{
  const {code}=req.body; let fqbn;
  try{fqbn=board(req.body.board||'arduino:avr:uno');}catch(e){return res.status(400).json({success:false,message:e.message});}
  if(!code)return res.status(400).json({success:false,message:'코드가 없습니다.'});
  const c=await cli(); if(!c)return res.status(500).json({success:false,message:'arduino-cli를 찾지 못했습니다. PATH를 확인하세요.'});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'miresol-')); const sketch=path.join(dir,'MiresolSketch'); fs.mkdirSync(sketch); fs.writeFileSync(path.join(sketch,'MiresolSketch.ino'),code,'utf8');
  try{
    await run(c,['compile','--fqbn',fqbn,sketch]);
    const list=JSON.parse((await run(c,['board','list','--format','json'])).out); const detected=list.detected_ports||[];
    let port=null;
    for(const x of detected){const a=x.port?.address||x.port?.label; if(!a)continue; const b=x.matching_boards?.[0]?.fqbn||''; if(!port)port=a;if(b===fqbn){port=a;break;}}
    if(!port)throw new Error('아두이노 포트를 찾지 못했습니다. USB 연결과 다른 시리얼 프로그램을 확인하세요.');
    const up=await run(c,['upload','-p',port,'--fqbn',fqbn,sketch]);
    res.json({success:true,port,board:fqbn,output:up.out});
  }catch(e){res.status(500).json({success:false,message:e.message});}
  finally{try{fs.rmSync(dir,{recursive:true,force:true});}catch(e){}}
});

app.listen(PORT,()=>console.log(`🚀 Miresol Block Platform: http://localhost:${PORT}`));
