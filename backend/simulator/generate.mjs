import {randomUUID} from "node:crypto";

const count=Math.max(1,Math.min(10000,Number(process.argv[2]||25)));
const base=(process.env.PGI_SIMULATOR_API||"http://127.0.0.1:8080/api/v1").replace(/\/$/,"");
const token=process.env.PGI_INGEST_TOKEN||"";
const networks=["Orange","SFR","Bouygues","Free"];
const experts=[
  {id:1,name:"Frederick"},{id:2,name:"Sofia"},{id:3,name:"Emma"},{id:4,name:"Lina"}
];

let ok=0,failed=0;
for(let i=0;i<count;i++){
  const now=Date.now();
  const conversation=120+(i*97)%1500;
  const started=new Date(now-(conversation+20)*1000);
  const bridged=new Date(started.getTime()+12*1000);
  const ended=new Date(bridged.getTime()+conversation*1000);
  const expert=experts[i%experts.length];
  const id=randomUUID();
  const envelope={
    source:"pgi-simulator",
    source_event_id:id,
    payload:{
      external_call_id:"sim-live-"+id,
      started_at:started.toISOString(),
      ivr_started_at:new Date(started.getTime()+2000).toISOString(),
      queued_at:new Date(started.getTime()+5000).toISOString(),
      bridged_at:bridged.toISOString(),
      ended_at:ended.toISOString(),
      wait_seconds:12,
      conversation_seconds:conversation,
      total_seconds:conversation+12,
      call_status:"connected",
      caller_masked:(i%2?"06":"07")+" •• •• "+String((i*7)%100).padStart(2,"0")+" "+String((i*13)%100).padStart(2,"0"),
      origin_carrier:networks[i%networks.length],
      origin_type:i%3===0?"fixed":"mobile",
      host_carrier:"SIMULATOR",
      sva_number:"089 SIMULÉ",
      expert_id:expert.id,
      expert_name:expert.name,
      sip_final_code:200,
      hangup_cause:"NORMAL_CLEARING",
      codec:"PCMA",
      quality:{packet_loss_percent:.05,jitter_ms:4.2,latency_ms:24,mos:4.3}
    }
  };
  const headers={"Content-Type":"application/json"};
  if(token)headers["X-PGI-Ingest-Token"]=token;
  try{
    const r=await fetch(base+"/ingest/cdr",{method:"POST",headers,body:JSON.stringify(envelope)});
    if(!r.ok)throw new Error("HTTP "+r.status);
    ok++;
  }catch(error){
    failed++;
    process.stderr.write(JSON.stringify({event:"simulator_ingest_failed",message:error.message,index:i})+"\n");
  }
}
process.stdout.write(JSON.stringify({event:"simulator_complete",requested:count,ok,failed,api:base})+"\n");
if(failed)process.exitCode=1;
