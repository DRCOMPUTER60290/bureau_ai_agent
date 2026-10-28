import * as THREE from 'three';
import { getScene, registerRoomTarget } from './scene.js?v=26';

// Room layout and furniture adapted from the open-source AgenticView scene.
// Source: https://github.com/VoidCU/agenticView (MIT). The orange agents remain project-owned.
const HEX_R = 7, APOTHEM = HEX_R * Math.sqrt(3) / 2, DEG = Math.PI / 180;
const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
const DOORS = [30,-30,-90,-150,150,90].map(a=>a*DEG);
const spaces = [
  room('office', 'Bureau du manager', 'office', -1, 0),
  room('pod-a', 'Pod A', 'pod', 1, 0), room('pod-b', 'Pod B', 'pod', 0, 1),
  room('pod-c', 'Pod C', 'pod', 1, -1), room('pod-d', 'Pod D', 'pod', -1, 1),
  room('meeting', 'Salle de réunion', 'meeting', 0, -1), room('lounge', 'Espace détente', 'lounge', 0, 0),
  room('myoffice', 'Mon bureau', 'myoffice', -2, 0), room('production', 'Studio créatif', 'production', -1, -1),
  room('research', 'Bibliothèque', 'research', -2, 1),
];
function room(id,name,kind,q,r){return {id,name,kind,q,r,x:10.5*q,z:7*Math.sqrt(3)*(r+q/2)}}
const podRooms=spaces.filter(s=>s.kind==='pod');
const seatLocal=(i)=>({x:(i%3-1)*1.2,z:i<3?-1.4:1.4,yaw:i<3?0:Math.PI});
const manager=spaces.find(s=>s.kind==='office');
const mh={x:manager.x+1.89*Math.cos(225*DEG),z:manager.z+1.89*Math.sin(225*DEG),yaw:Math.PI/4};
export const DESK_SLOTS=podRooms.flatMap((s)=>Array.from({length:6},(_,i)=>{
  const p=seatLocal(i); const deskZ=p.z<0?p.z-.36:p.z+.36;
  const standZ=p.z+(p.z<0?.55:-.55);
  return {id:`${s.id}-${i}`,x:s.x+p.x,z:s.z+standZ,standX:s.x+p.x,standZ:s.z+standZ,ry:p.yaw,deskX:s.x+p.x,deskZ:s.z+deskZ,space:s.id,seat:i};
}));
export const PATRON_SLOT={x:mh.x,z:mh.z,ry:mh.yaw};
export const LOUNGE_BREAK_SPOTS=[{x:1.5,z:1.5},{x:-1.5,z:1.5},{x:0,z:-2.2}];

// Dynamic geometry obstacles for the walk planner. Walls are represented as line segments,
// preserving the original 1.8-unit door openings between adjacent rooms.
export const WALK_OBSTACLES=[];
export const WALK_WALLS=[];

const C={
  floorEdge:0x303b49,wall:0x3a4655,glass:0x83b5c4,alu:0x758493,wood:0x755b46,walnut:0x533b32,
  desk:0xc6c9c4,leg:0x303943,felt:0x516e68,bezel:0x171c25,screen:0x286478,keyboard:0x89939d,
  chair:0x333d48,chairBase:0x202832,pot:0x606b71,leaf:0x39735a,leaf2:0x5b936a,shelf:0x66513f,
  book:0x456b82,sofa:0x98604d,sofa2:0x426d69,cushion:0xc3a778,rug:0x53626a,rug2:0x95634f,
  carpet:0x454f5a,meeting:0x385a63,office:0x283b54,accent:0xc18b48,white:0xcbd0ce,
};
const mats=Object.fromEntries(Object.entries(C).map(([k,c])=>[k,new THREE.MeshStandardMaterial({color:c,roughness:k==='glass'?.22:.84,metalness:k==='alu'?.55:0,transparent:k==='glass',opacity:k==='glass'?.34:1})]));
function floorTexture(base,wood=false){
 const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');ctx.fillStyle=`#${new THREE.Color(base).getHexString()}`;ctx.fillRect(0,0,512,512);
 let seed=wood?7:11;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296};
 if(wood){for(let row=0;row<8;row++){let x=-rand()*180;while(x<512){const w=180+rand()*210;ctx.fillStyle=`rgba(${rand()>.5?'255,245,220':'55,35,20'},${.025+rand()*.06})`;ctx.fillRect(x,row*64,w,64);for(let i=0;i<5;i++){ctx.strokeStyle='rgba(75,45,20,.09)';ctx.lineWidth=.7;ctx.beginPath();let y=row*64+rand()*64;ctx.moveTo(x,y);ctx.bezierCurveTo(x+w*.3,y+3,x+w*.7,y-2,x+w,y+1);ctx.stroke()}ctx.fillStyle='rgba(55,35,20,.12)';ctx.fillRect(x,row*64,1,64);x+=w}}}
 else{const tile=128;for(let i=0;i<4;i++)for(let j=0;j<4;j++){ctx.fillStyle=`rgba(${(i+j)%2?'255,255,255':'25,20,15'},.025)`;ctx.fillRect(i*tile,j*tile,tile,tile);ctx.globalAlpha=.055;ctx.strokeStyle='#382f28';for(let k=8;k<tile;k+=8){ctx.beginPath();if((i+j)%2===0){ctx.moveTo(i*tile+k,j*tile);ctx.lineTo(i*tile+k,(j+1)*tile)}else{ctx.moveTo(i*tile,j*tile+k);ctx.lineTo((i+1)*tile,j*tile+k)}ctx.stroke()}ctx.globalAlpha=1}}
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(wood?3:2.5,wood?3:2.5);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
const floorMats={wood:new THREE.MeshStandardMaterial({map:floorTexture('#755b46',true),roughness:.62}),office:new THREE.MeshStandardMaterial({map:floorTexture('#283b54',false),roughness:.9}),carpet:new THREE.MeshStandardMaterial({map:floorTexture('#454f5a',false),roughness:.95}),meeting:new THREE.MeshStandardMaterial({map:floorTexture('#385a63',false),roughness:.95})};
function mesh(geom,mat,x,y,z,group,rot=0){const m=new THREE.Mesh(geom,mats[mat]||mat);m.position.set(x,y,z);m.rotation.y=rot;m.castShadow=true;m.receiveShadow=true;group.add(m);return m;}
function box(g,mat,x,y,z,w,h,d,rot=0){return mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z,g,rot)}
function cyl(g,mat,x,y,z,d,h,n=16){return mesh(new THREE.CylinderGeometry(d/2,d/2,h,n),mat,x,y,z,g)}
function groupAt(parent,x,z,yaw=0){const g=new THREE.Group();g.position.set(x,0,z);g.rotation.y=yaw;parent.add(g);return g}
function circleFloor(g,color){const m=new THREE.Mesh(new THREE.CircleGeometry(140,64),new THREE.MeshStandardMaterial({color,roughness:1}));m.rotation.x=-Math.PI/2;m.position.y=-.14;m.receiveShadow=true;g.add(m)}

function floorTile(s){
  const g=new THREE.Group();g.position.set(s.x,-.06,s.z);g.rotation.y=Math.PI/6;getScene().add(g);
  const base=mesh(new THREE.CylinderGeometry(HEX_R-.02,HEX_R-.02,.12,6),mats.floorEdge,0,0,0,g);
  const color=s.kind==='office'?floorMats.office:s.kind==='lounge'?floorMats.wood:s.kind==='meeting'?floorMats.meeting:floorMats.carpet;
  const top=mesh(new THREE.CylinderGeometry(HEX_R-.04,HEX_R-.04,.012,6),color,0,.051,0,g);top.rotation.y=0;
  registerRoomTarget(top, s);
  const ring=new THREE.Mesh(new THREE.RingGeometry(HEX_R-.27,HEX_R-.14,6),new THREE.MeshBasicMaterial({color:0x8da5aa,side:THREE.DoubleSide,transparent:true,opacity:.3}));ring.rotation.x=-Math.PI/2;ring.position.y=.006;g.add(ring);
  return g;
}
function floorLabel(s){
 const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;const ctx=canvas.getContext('2d');
 ctx.clearRect(0,0,1024,256);ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='800 142px system-ui, sans-serif';ctx.lineJoin='round';ctx.lineWidth=10;ctx.strokeStyle='rgba(21,28,37,.7)';ctx.strokeText(s.name.toUpperCase(),512,132);ctx.fillStyle='rgba(213,222,226,.74)';ctx.fillText(s.name.toUpperCase(),512,132);
 const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
 const label=new THREE.Mesh(new THREE.PlaneGeometry(4.6,1.15),new THREE.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,opacity:.82}));
 const a=Math.PI/4,dist=s.kind==='office'?4.2:4.3;label.position.set(s.x+dist*Math.cos(a),.006,s.z+dist*Math.sin(a));label.rotation.set(-Math.PI/2,0,Math.PI/4);getScene().add(label);
}
function point(s,r,a){return {x:s.x+r*Math.cos(a),z:s.z+r*Math.sin(a)}}
function addWalls(){
 const done=new Set();
 for(const s of spaces)DIRS.forEach(([dq,dr],dir)=>{
   const n=spaces.find(o=>o.q===s.q+dq&&o.r===s.r+dr);
   if(n&&(n.q<s.q||(n.q===s.q&&n.r<s.r)))return;
   const a=DOORS[dir],c1=point(s,HEX_R,a-30*DEG),c2=point(s,HEX_R,a+30*DEG);
   const key=p=>`${p.x.toFixed(2)},${p.z.toFixed(2)}`;
   for(const p of [c1,c2])if(!done.has(key(p))){done.add(key(p));const post=box(getScene(),'alu',p.x,0.595,p.z,.1,1.19,.1);}
   const open=!!n;
   const ux=(c2.x-c1.x)/HEX_R,uz=(c2.z-c1.z)/HEX_R;
   const segments=open?[[c1,{x:c1.x+ux*(HEX_R-1.8)/2,z:c1.z+uz*(HEX_R-1.8)/2}],[{x:c2.x-ux*(HEX_R-1.8)/2,z:c2.z-uz*(HEX_R-1.8)/2},c2]]:[[c1,c2]];
   for(const [p1,p2] of segments){
     const dx=p2.x-p1.x,dz=p2.z-p1.z,len=Math.hypot(dx,dz),x=(p1.x+p2.x)/2,z=(p1.z+p2.z)/2,yaw=Math.atan2(dx,dz)-Math.PI/2;
     box(getScene(),'wall',x,.24,z,len,.48,.1,yaw);box(getScene(),'glass',x,.77,z,len,.58,.035,yaw);box(getScene(),'alu',x,1.17,z,len,.04,.07,yaw);box(getScene(),'alu',x,.5,z,len,.025,.06,yaw);
     WALK_WALLS.push({a:p1,b:p2});
   }
   if(open){for(const f of [.5]){const p1={x:c1.x+ux*(HEX_R-1.8)/2,z:c1.z+uz*(HEX_R-1.8)/2},p2={x:c2.x-ux*(HEX_R-1.8)/2,z:c2.z-uz*(HEX_R-1.8)/2};for(const p of [p1,p2])box(getScene(),'alu',p.x,.7,p.z,.09,1.4,.09);}}
 });
}
function desk(g,x,z,yaw,seed=0){const d=groupAt(g,x,z,yaw);box(d,'desk',0,.715,0,1.18,.05,.66);for(const px of [-.54,.54])box(d,'leg',px,.36,0,.05,.69,.58);box(d,'leg',0,.5,-.22,1.1,.16,.02);
 box(d,'bezel',0,1.06,-.18,.66,.4,.03,-.08);box(d,'screen',0,1.06,-.158,.61,.35,.012,-.08);box(d,'alu',0,.86,-.21,.05,.22,.03);box(d,'keyboard',-.02,.75,.1,.44,.018,.14);box(d,'keyboard',.33,.75,.12,.07,.02,.1);
 if(seed%3===0){cyl(d,'pot',-.45,.80,.02,.09,.12);plant(d,-.45,.85,.8,seed)}
 if(seed%4===2)box(d,'book',-.42,.78,-.05,.24,.05,.3,.2);
 return d;}
function chair(g,x,z,yaw=0){const c=groupAt(g,x,z,yaw);box(c,'chair',0,.47,0,.5,.08,.48);box(c,'chair',0,.82,-.25,.46,.52,.07,-.1);cyl(c,'chairBase',0,.27,0,.06,.38);cyl(c,'chairBase',0,.05,0,.56,.04);for(const x of [-.26,.26])box(c,'chairBase',x,.6,-.02,.04,.03,.3);}
function plant(g,x,z,scale=1,seed=0){const p=groupAt(g,x,z);cyl(p,'pot',0,.22*scale,0,.42*scale,.44*scale);cyl(p,'chairBase',0,.45*scale,0,.36*scale,.02);for(let i=0;i<5;i++){const a=i*2.4+seed;const leaf=mesh(new THREE.IcosahedronGeometry(.43*scale,0),i%2?'leaf':'leaf2',Math.cos(a)*.2*scale,.82*scale+(i%3)*.22*scale,Math.sin(a)*.2*scale,p);leaf.scale.set(.65,.95,.65)}}
function shelf(g,x,z,yaw=0){const p=groupAt(g,x,z,yaw);for(const x of [-.65,.65])box(p,'shelf',x,.85,0,.04,1.7,.36);for(let i=0;i<5;i++){const y=i*.42;box(p,'shelf',0,y,0,1.3,.035,.36);for(let b=0;b<5;b++){const h=.22+(b%3)*.045;box(p,['book','accent','leaf','sofa2'][b%4],-.48+b*.22,y+h/2+.03,.04,.12,h,.23)}}}
function whiteboard(g,x,z,yaw=0){const p=groupAt(g,x,z,yaw);box(p,'alu',0,1.12,0,1.8,1.04,.04);box(p,'white',0,1.12,.027,1.66,.92,.01);for(let x of [-.85,.85])box(p,'alu',x,.85,0,.04,1.7,.04)}
function sofa(g,x,z,yaw=0,width=1.9,mat='sofa'){const p=groupAt(g,x,z,yaw);box(p,mat,0,.24,0,width,.3,.86);box(p,mat,0,.6,-.33,width,.56,.22);for(const x of [-width/2+.1,width/2-.1])box(p,mat,x,.44,0,.2,.36,.86);box(p,'cushion',-width/4,.68,-.14,.36,.34,.12,-.25)}
function credenza(g,x,z,yaw=0){const p=groupAt(g,x,z,yaw);box(p,'shelf',0,.34,0,1.6,.62,.46);box(p,'leg',0,.02,0,1.5,.04,.4);for(let i=0;i<4;i++)box(p,['book','accent','white','sofa2'][i],.25+i*.07,.76,-.02,.05,.28,.22)}
function podFurniture(s,index){const g=groupAt(getScene(),s.x,s.z);
 for(let i=0;i<6;i++){const p=seatLocal(i),dz=p.z<0?-.36:.36;desk(g,p.x,dz,p.z<0?Math.PI:0,index*6+i);chair(g,p.x,p.z+(p.z<0?-.25:.25),p.yaw)}
 box(g,'felt',0,.94,0,3.8,.4,.06);box(g,'alu',0,1.15,0,3.8,.03,.06);
 shelf(g,0,4.8,Math.PI);whiteboard(g,-3.8,2.2,-Math.PI/4);credenza(g,3.9,-2.25,Math.PI/3);plant(g,4.1,.2,1.1,index);plant(g,-2.3,4.1,.9,index+1);
}
function managerFurniture(s){const g=groupAt(getScene(),s.x,s.z);cyl(g,'office',0,.006,0,6,.012,48);cyl(g,'accent',0,.004,0,6.1,.008,48);
 const at={x:mh.x-s.x+Math.cos(45*DEG)*.78,z:mh.z-s.z+Math.sin(45*DEG)*.78};const d=groupAt(g,at.x,at.z,Math.PI/4);
 box(d,'walnut',0,.75,0,2.1,.07,.95);box(d,'walnut',-.82,.37,0,.42,.72,.85);box(d,'leg',.95,.37,0,.05,.72,.85);box(d,'walnut',.1,.45,-.44,1.5,.5,.03);box(d,'bezel',.62,1.02,-.2,.62,.38,.03);box(d,'screen',.63,1.02,-.18,.57,.33,.012);
 chair(g,mh.x-s.x-.15*Math.sin(mh.yaw),mh.z-s.z-.15*Math.cos(mh.yaw),mh.yaw);shelf(g,0,4.6,Math.PI);whiteboard(g,-3.8,2.2,-Math.PI/4);credenza(g,3.9,-2.25);sofa(g,4.2,.1,Math.PI,1,'sofa2');plant(g,-2.3,4.1,1.2);plant(g,2.3,4.1,1);
}
function loungeFurniture(s){const g=groupAt(getScene(),s.x,s.z);cyl(g,'rug',0,.012,0,5.4,.012,48);cyl(g,'rug2',0,.024,0,4.2,.012,48);cyl(g,'walnut',0,.38,0,1.5,.05);cyl(g,'leg',0,.19,0,.16,.36);cyl(g,'accent',.15,.46,.1,.1,.12);sofa(g,-2.8,0,-Math.PI/2,2.4);sofa(g,2.8,0,Math.PI/2,2.4);sofa(g,0,2.9,Math.PI,1.2,'sofa2');plant(g,-4.4,0,1.2);plant(g,4.4,0,.8);credenza(g,0,-4.1,Math.PI)}
function otherFurniture(s){const g=groupAt(getScene(),s.x,s.z);if(s.kind==='meeting'){cyl(g,'walnut',0,.74,0,4.2,.07,32);cyl(g,'leg',0,.37,0,.48,.7);for(let i=0;i<6;i++){let a=i*Math.PI/3;chair(g,2.7*Math.cos(a),2.7*Math.sin(a),a+Math.PI/2)}whiteboard(g,0,-4.7,0);credenza(g,4.1,-2.3);plant(g,-4.4,.2,1)}
 else if(s.kind==='myoffice'){const d=groupAt(g,-1.4,2.4,Math.PI/6);box(d,'rug2',0,.01,0,3.6,.012,2.9);box(d,'walnut',0,.75,0,1.9,.07,.85);box(d,'screen',0,1.8,-4.5,3.2,1.8,.06);sofa(g,-4.3,0,Math.PI/3,1.9);sofa(g,4.2,0,Math.PI/2,1,'sofa2');plant(g,0,4.5,1.2);credenza(g,4,-2.3)}
 else if(s.kind==='production'){box(g,'screen',0,1.8,-5.95,3.2,1.8,.06);for(let i=0;i<2;i++){const x=i?1:-1;desk(g,x,-.6,0,20+i);chair(g,x,.4,Math.PI)}box(g,'leaf',0,1.2,4.9,1.9,2.3,.04);plant(g,4.4,.2,.9);whiteboard(g,-4.1,2.3,-Math.PI/4)}
 else if(s.kind==='research'){box(g,'rug',0,.01,0,4.2,.012,3.4);box(g,'walnut',0,.72,0,2.8,.06,1.1);for(const x of [-.7,.7])for(const z of [-1,1])chair(g,x,z,z<0?0:Math.PI);for(const x of [-4.4,4.4])shelf(g,x,0,x<0?Math.PI/2:-Math.PI/2);plant(g,-3.5,3.2,1);whiteboard(g,3.4,3.4,Math.PI/4)}
}

function addWalkObstacle(s,x,z,halfX,halfZ,yaw=0){
 const c=Math.abs(Math.cos(yaw)),q=Math.abs(Math.sin(yaw));
 WALK_OBSTACLES.push({x:s.x+x,z:s.z+z,halfX:c*halfX+q*halfZ,halfZ:q*halfX+c*halfZ});
}

export function initOffice(){
 const scene=getScene();circleFloor(scene,0x171c25);
 const groundLight=new THREE.HemisphereLight(0xe4e9ed,0x343b43,.72);scene.add(groundLight);
 const sun=new THREE.DirectionalLight(0xffe8d2,1.25);sun.position.set(16,26,16);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-45;sun.shadow.camera.right=45;sun.shadow.camera.top=45;sun.shadow.camera.bottom=-45;scene.add(sun);
 for(const s of spaces){floorTile(s);floorLabel(s)}
 addWalls();
 let podIndex=0;for(const s of spaces){if(s.kind==='pod')podFurniture(s,podIndex++);else if(s.kind==='office')managerFurniture(s);else if(s.kind==='lounge')loungeFurniture(s);else otherFurniture(s);}
 // Static navigation footprint for the furniture. The planner adds character clearance
 // around these bounds, so agents route around desks, dividers, shelves and lounge pieces.
 for(const slot of DESK_SLOTS)WALK_OBSTACLES.push({x:slot.deskX,z:slot.deskZ,halfX:.65,halfZ:.48});
 for(const s of podRooms){
  addWalkObstacle(s,0,0,1.9,.1);
  for(let i=0;i<6;i++){const p=seatLocal(i);addWalkObstacle(s,p.x,p.z+(p.z<0?-.25:.25),.27,.27)}
  addWalkObstacle(s,0,4.8,.72,.22,Math.PI);
  addWalkObstacle(s,3.9,-2.25,.8,.23,Math.PI/3);
  addWalkObstacle(s,-2.3,4.1,.52,.52);
  addWalkObstacle(s,4.1,.2,.58,.58);
 }
 // Lounge: coffee table, sofas, low cabinet and plants.
 for(const p of [[-2.8,0,.68,1.28],[2.8,0,.68,1.28],[0,2.9,.7,.48],[0,-4.1,.82,.3],[-4.4,0,.58,.58],[4.4,0,.5,.5]])
  addWalkObstacle(spaces.find(s=>s.kind==='lounge'),p[0],p[1],p[2],p[3]);
 addWalkObstacle(spaces.find(s=>s.kind==='lounge'),0,0,.78,.78);
 // Keep the other shared rooms walkable around their main furniture.
 const meeting=spaces.find(s=>s.kind==='meeting');
 addWalkObstacle(meeting,0,0,2.12,2.12);
 for(let i=0;i<6;i++){const a=i*Math.PI/3;addWalkObstacle(meeting,2.7*Math.cos(a),2.7*Math.sin(a),.34,.34)}
 const research=spaces.find(s=>s.kind==='research');
 addWalkObstacle(research,0,0,1.48,.62);
 addWalkObstacle(research,-4.4,0,.22,.78,Math.PI/2);addWalkObstacle(research,4.4,0,.22,.78,Math.PI/2);
 const myoffice=spaces.find(s=>s.kind==='myoffice');
 addWalkObstacle(myoffice,-1.4,2.4,.98,.46,Math.PI/6);
 addWalkObstacle(myoffice,-4.3,0,.56,1.06,Math.PI/3);addWalkObstacle(myoffice,4.2,0,.56,.62,Math.PI/2);
 const production=spaces.find(s=>s.kind==='production');
 addWalkObstacle(production,-1,-.6,.65,.48);addWalkObstacle(production,1,-.6,.65,.48);
}
initOffice();

