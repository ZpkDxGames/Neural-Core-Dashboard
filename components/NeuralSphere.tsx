'use client';
import { Canvas, ThreeEvent, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import { BufferAttribute, Group, MathUtils, Vector3 } from 'three';
import type { GraphNode, KnowledgeGraph } from '../lib/types';

const COLORS: Record<string,string> = {
  'Development':'#91acf7', 'AI & Automation':'#c2a5f4', 'UI / UX':'#68ddd1',
  'Learning':'#f3c67f', 'Gaming':'#83c9a7', 'Infrastructure':'#9cb6cc',
  'Planning':'#ef9cb6', 'General':'#b9bdcc', 'Core':'#eef4ff', 'Sources':'#8b91ed'
};
const categoryNames=Object.keys(COLORS).filter(x=>x!=='Core'&&x!=='Sources');
function hash(s: string): number {
  let n=2166136261;
  for(let i=0;i<s.length;i++){n^=s.charCodeAt(i);n=Math.imul(n,16777619);}
  return n>>>0;
}
function random(key: string): number {return hash(key)/4294967295;}
function fibonacci(i: number,n: number): Vector3 {
  const y=1-(i/(n-1))*2;
  const r=Math.sqrt(1-y*y);
  const theta=Math.PI*(3-Math.sqrt(5))*i;
  return new Vector3(Math.cos(theta)*r,y,Math.sin(theta)*r);
}
function colorVec(hex: string): [number,number,number] {
  const n=parseInt(hex.slice(1),16);
  // Vertex colors are linear-light to match WebGL's color handling.
  const srgb=(v:number)=>{const c=v/255;return c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4);};
  return [srgb((n>>16)&255),srgb((n>>8)&255),srgb(n&255)];
}
function makeBuffers(graph: KnowledgeGraph) {
  const positionById=new Map<string,Vector3>();
  const points=new Float32Array(graph.nodes.length*3);
  const colors=new Float32Array(graph.nodes.length*3);
  const directions=new Map(categoryNames.map((c,i)=>[c,fibonacci(i,categoryNames.length)]));
  graph.nodes.forEach((node,i)=>{
    let p: Vector3;
    if(node.type==='core')p=new Vector3();
    else if(node.type==='category')p=(directions.get(node.category)||new Vector3(0,1,0)).clone().multiplyScalar(2.75);
    else if(node.type==='provider'){
      const idx=['chatgpt','claude','gemini','generic'].indexOf(node.provider||'');
      p=fibonacci(Math.max(0,idx),4).multiplyScalar(1.85);
    } else {
      const base=(directions.get(node.category)||fibonacci(4,8)).clone().multiplyScalar(0.79);
      const j=new Vector3(random(node.id+'x')-.5,random(node.id+'y')-.5,random(node.id+'z')-.5).multiplyScalar(1.65);
      p=base.add(j).normalize().multiplyScalar(3.10+random(node.id+'r')*1.38);
    }
    positionById.set(node.id,p);
    points.set([p.x,p.y,p.z],i*3);
    const [r,g,b]=colorVec(COLORS[node.category]||COLORS.General);
    const strength=node.type==='conversation'?.65+.35*node.strength:1;
    colors.set([r*strength,g*strength,b*strength],i*3);
  });
  const edgeValues:number[]=[];
  for(const edge of graph.edges){
    const a=positionById.get(edge.source);const b=positionById.get(edge.target);
    if(!a||!b)continue;
    edgeValues.push(a.x,a.y,a.z,b.x,b.y,b.z);
  }
  return {points,colors,lines:new Float32Array(edgeValues)};
}
function Scene({graph,playing,onSelect}:{graph:KnowledgeGraph;playing:boolean;onSelect:(node:GraphNode)=>void}){
  const group=useRef<Group>(null);
  const buffers=useMemo(()=>makeBuffers(graph),[graph]);
  const pointPositions=useMemo(()=>new BufferAttribute(buffers.points,3),[buffers]);
  const pointColors=useMemo(()=>new BufferAttribute(buffers.colors,3),[buffers]);
  const linePositions=useMemo(()=>new BufferAttribute(buffers.lines,3),[buffers]);
  useFrame((_,delta)=>{
    if(group.current&&playing)group.current.rotation.y+=Math.min(delta,0.08)*0.055;
  });
  function nodeClick(e: ThreeEvent<MouseEvent>) {
    e.stopPropagation();
    const index=e.index;
    if(typeof index==='number'&&graph.nodes[index])onSelect(graph.nodes[index]);
  }
  return <>
    <ambientLight intensity={0.8}/>
    <pointLight position={[4,5,8]} color="#b6c7ff" intensity={22}/>
    <group ref={group} rotation={[MathUtils.degToRad(-8),0,0]}>
      <mesh><sphereGeometry args={[4.54,40,26]}/><meshBasicMaterial color="#42567b" wireframe transparent opacity={0.045} depthWrite={false}/></mesh>
      <lineSegments>
        <bufferGeometry><primitive attach="attributes-position" object={linePositions}/></bufferGeometry>
        <lineBasicMaterial color="#7c96c5" transparent opacity={0.17} depthWrite={false}/>
      </lineSegments>
      <points onClick={nodeClick}>
        <bufferGeometry>
          <primitive attach="attributes-position" object={pointPositions}/>
          <primitive attach="attributes-color" object={pointColors}/>
        </bufferGeometry>
        <pointsMaterial size={0.085} vertexColors sizeAttenuation transparent opacity={0.98} depthWrite={false}/>
      </points>
      <mesh><sphereGeometry args={[0.28,24,24]}/><meshStandardMaterial color="#d6e7ff" emissive="#8bafe5" emissiveIntensity={0.65} roughness={0.24} metalness={0.55}/></mesh>
      <mesh><sphereGeometry args={[0.48,24,24]}/><meshBasicMaterial color="#aabdfb" transparent opacity={0.075} depthWrite={false}/></mesh>
    </group>
    <OrbitControls makeDefault enablePan={false} enableDamping dampingFactor={0.07} rotateSpeed={0.54} minDistance={6.5} maxDistance={17} />
  </>;
}
export default function NeuralSphere({graph,playing,onSelect}:{graph:KnowledgeGraph;playing:boolean;onSelect:(node:GraphNode)=>void}) {
  return <Canvas dpr={[1,1.65]} camera={{position:[0,1,10.5],fov:48,near:0.1,far:100}} gl={{antialias:true,alpha:true,powerPreference:'high-performance'}} style={{width:'100%',height:'100%'}}>
    <Scene graph={graph} playing={playing} onSelect={onSelect}/>
  </Canvas>;
}
export { COLORS };
