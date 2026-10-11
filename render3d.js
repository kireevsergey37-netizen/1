/* Local WebGL renderer: lit materials, procedural terrain and articulated vehicles. */
(() => {
  'use strict';
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const normalize = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  function matrix(eye, target, aspect, fov) {
    const z = normalize(eye.map((v, i) => v - target[i]));
    const x = normalize(cross([0, 1, 0], z)), y = cross(z, x);
    const dot = v => -v.reduce((sum, n, i) => sum + n * eye[i], 0);
    const view = [x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,dot(x),dot(y),dot(z),1];
    const f = 1 / Math.tan(fov / 2), near = .2, far = 420;
    const projection = [f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
    const result = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) result[c*4+r] += projection[k*4+r] * view[c*4+k];
    }
    return result;
  }
  const cornerX = [-1,1,1,-1,-1,1,1,-1], cornerY = [-1,-1,1,1,-1,-1,1,1];
  const faces = [
    [[0,1,2,0,2,3], .78], [[4,7,6,4,6,5], .92],
    [[0,4,5,0,5,1], .64], [[3,2,6,3,6,7], 1.08],
    [[0,3,7,0,7,4], .73], [[1,5,6,1,6,2], .9]
  ];
  class ConvoyRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl', {alpha:false, antialias:true});
      if (!this.gl) throw new Error('Для 3D-гонки нужен браузер с поддержкой WebGL.');
      this.vertices = new Float32Array(1200000); this.count = 0; this.colors = new Map(); this.corners = new Float32Array(24);
      this.init();
    }
    init() {
      const gl = this.gl;
      const shader = (type, source) => {
        const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const vertex = shader(gl.VERTEX_SHADER, `
        attribute vec3 aPosition; attribute vec3 aColor; attribute vec2 aUV;
        attribute vec3 aNormal; attribute float aMaterial;
        uniform mat4 uMatrix;
        varying vec3 vColor; varying vec2 vUV; varying float vDepth;
        varying vec3 vWorld; varying vec3 vNormal; varying float vMaterial;
        void main(){gl_Position=uMatrix*vec4(aPosition,1.0);vColor=aColor;vUV=aUV;
          vDepth=gl_Position.w;vWorld=aPosition;vNormal=aNormal;vMaterial=aMaterial;}`);
      const fragment = shader(gl.FRAGMENT_SHADER, `
        precision mediump float;
        varying vec3 vColor; varying vec2 vUV; varying float vDepth;
        varying vec3 vWorld; varying vec3 vNormal; varying float vMaterial;
        uniform sampler2D uSign; uniform vec3 uEye; uniform float uTravel; uniform float uTime;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
        void main(){
          float m=vMaterial;vec3 color=vColor;float alpha=1.0;
          if(m>8.5&&m<10.5){
            float r=length(vUV*2.0-1.0);if(r>1.0)discard;
            alpha=(1.0-smoothstep(.15,1.0,r))*(m<9.5?.32:.52);
            gl_FragColor=vec4(color,alpha);return;
          }
          if(m>7.5&&m<8.5){
            float h=clamp(vWorld.y/120.0,0.0,1.0);
            color=mix(vec3(.77,.82,.82),vec3(.35,.59,.78),sqrt(h));
            float cloud=noise(vWorld.xy*.026)*.65+noise(vWorld.xy*.061)*.35;
            float clouds=smoothstep(.53,.73,cloud)*smoothstep(8.,45.,vWorld.y);
            color=mix(color,vec3(.94,.95,.94),clouds*.65);
            float sun=length((vWorld.xy-vec2(-92.,102.))/vec2(1.,.9));
            color+=vec3(.3,.25,.15)*exp(-sun*.07);
            color=mix(color,vec3(1.,.94,.76),1.-smoothstep(5.,6.5,sun));
            gl_FragColor=vec4(color,1.0);return;
          }
          vec3 n=normalize(vNormal),light=normalize(vec3(-.45,.83,-.32));
          vec3 view=normalize(uEye-vWorld);float diffuse=max(dot(n,light),0.0);
          vec2 ground=vec2(vWorld.x,vWorld.z+uTravel);
          if(m>.5&&m<1.5){
            float grain=hash(floor(ground*18.0));
            color*=.86+grain*.25+noise(ground*.32)*.12;
            color*=1.0-smoothstep(.955,.998,noise(ground*1.4))*.3;
          }
          if(m>1.5&&m<2.5)color*=.84+noise(ground*.7)*.25+hash(floor(ground*9.0))*.12;
          if(m>5.5&&m<6.5)color*=.8+hash(floor(vWorld.xy*27.0))*.25;
          if(vUV.x>=0.0)color=texture2D(uSign,vUV).rgb;
          float spec=0.0;
          if((m>2.5&&m<5.5)||m>10.5){
            float shine=m>3.5&&m<4.5?64.0:32.0;
            spec=pow(max(dot(n,normalize(light+view)),0.0),shine)*(.25+diffuse*.55);
          }
          if(m>3.5&&m<4.5){
            float fresnel=pow(1.0-max(dot(n,view),0.0),3.0);
            color=mix(color,vec3(.65,.81,.9),.2+fresnel*.5);
            color+=pow(max(n.y,0.0),2.0)*vec3(.12,.2,.24);
          }
          color*=vec3(.38,.43,.48)+diffuse*vec3(.68,.64,.56);
          color+=spec*vec3(1.,.94,.8);
          if(m>6.5&&m<7.5)color=vColor*1.3;
          if(m>10.5&&m<11.5){
            vec3 glow=mix(vec3(.2,1.,.88),vec3(.66,.46,1.),sin(uTime*2.0)*.5+.5);
            float rim=pow(1.0-max(dot(n,view),0.0),2.0);
            color+=glow*(.23+rim*.8);
          }
          if(m>11.5)color+=vec3(.35,.18,.045);
          float fog=smoothstep(105.0,280.0,vDepth);
          gl_FragColor=vec4(mix(color,vec3(.73,.79,.81),fog),alpha);
        }`);
      this.program = gl.createProgram(); gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      gl.useProgram(this.program); this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (const [name, size, offset] of [['aPosition',3,0],['aColor',3,12],['aUV',2,24],['aNormal',3,32],['aMaterial',1,44]]) {
        const location = gl.getAttribLocation(this.program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,size,gl.FLOAT,false,48,offset);
      }
      this.uMatrix = gl.getUniformLocation(this.program,'uMatrix');
      this.uEye=gl.getUniformLocation(this.program,'uEye');this.uTravel=gl.getUniformLocation(this.program,'uTravel');this.uTime=gl.getUniformLocation(this.program,'uTime');
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,this.texture);
      const sign = document.createElement('canvas'); sign.width=1024;sign.height=512;
      const ctx=sign.getContext('2d');ctx.fillStyle='#193249';ctx.fillRect(0,0,1024,512);
      ctx.strokeStyle='#9ce5d1';ctx.lineWidth=8;ctx.strokeRect(6,6,1012,116);
      ctx.textAlign='center';ctx.fillStyle='#f0f8fa';ctx.font='bold 48px sans-serif';ctx.fillText('ИСПРАВИТЕЛЬНАЯ КОЛОНИЯ',512,65);
      ctx.fillStyle='#9ce5d1';ctx.font='bold 25px sans-serif';ctx.fillText('КПП · ВЪЕЗД ЧЕРЕЗ ТРАНСПОРТНЫЙ ШЛЮЗ',512,102);
      ctx.fillStyle='#176b43';ctx.fillRect(0,128,1024,128);ctx.fillStyle='#ffffff';ctx.font='bold 83px sans-serif';ctx.fillText('ФСИН России',512,221);
      ctx.fillStyle='#273a43';ctx.fillRect(0,256,1024,128);ctx.fillStyle='#ffe398';ctx.font='bold 53px sans-serif';ctx.fillText('ТРАНСПОРТНЫЙ ШЛЮЗ',512,316);
      ctx.font='bold 30px sans-serif';ctx.fillStyle='#e8f2ec';ctx.fillText('КОНТРОЛЬНО-ПРОПУСКНОЙ ПУНКТ',512,365);
      ctx.fillStyle='#8e393d';ctx.fillRect(0,384,1024,128);ctx.fillStyle='#fff0d4';ctx.font='bold 48px sans-serif';ctx.fillText('РЕЖИМНАЯ ТЕРРИТОРИЯ',512,447);
      ctx.font='bold 27px sans-serif';ctx.fillText('ПРОХОД ЧЕРЕЗ КПП',512,491);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sign);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.program,'uSign'),0);gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.clearColor(.73,.79,.81,1);
    }
    vertex(x,y,z,color,u=-1,v=-1,normal=[0,1,0],material=0) {
      let nx=normal[0],ny=normal[1],nz=normal[2];
      if(this.model){
        const t=this.model;
        let xx=x*t.cr-y*t.sr,yy=x*t.sr+y*t.cr;
        y=yy*t.cp-z*t.sp;z=yy*t.sp+z*t.cp;
        x=xx*t.cy+z*t.sy;z=-xx*t.sy+z*t.cy;
        x+=t.x;y+=t.y;z+=t.z;
        xx=nx*t.cr-ny*t.sr;yy=nx*t.sr+ny*t.cr;
        ny=yy*t.cp-nz*t.sp;nz=yy*t.sp+nz*t.cp;
        nx=xx*t.cy+nz*t.sy;nz=-xx*t.sy+nz*t.cy;
      }
      if(this.count+12>this.vertices.length){const bigger=new Float32Array(this.vertices.length*2);bigger.set(this.vertices);this.vertices=bigger;}
      const a=this.vertices;let i=this.count;
      a[i++]=x;a[i++]=y;a[i++]=z;a[i++]=color[0];a[i++]=color[1];a[i++]=color[2];
      a[i++]=u;a[i++]=v;a[i++]=nx;a[i++]=ny;a[i++]=nz;a[i++]=material;this.count=i;
    }
    box(x,y,z,w,h,d,hex,yaw=0,material=0) {
      let palette=this.colors.get(hex);
      if(!palette){const base=rgb(hex);palette=faces.map(()=>base);this.colors.set(hex,palette);}
      const c=Math.cos(yaw),s=Math.sin(yaw),corners=this.corners;
      for(let i=0;i<8;i++){
        const xx=cornerX[i]*w/2;
        const yy=cornerY[i]*h/2;
        const zz=(i<4?-1:1)*d/2;
        corners[i*3]=x+xx*c+zz*s;corners[i*3+1]=y+yy;corners[i*3+2]=z-xx*s+zz*c;
      }
      const normals=[[0,0,-1],[0,0,1],[0,-1,0],[0,1,0],[-1,0,0],[1,0,0]];
      for(let f=0;f<faces.length;f++){const n=normals[f],normal=[n[0]*c+n[2]*s,n[1],-n[0]*s+n[2]*c];for(const i of faces[f][0])this.vertex(corners[i*3],corners[i*3+1],corners[i*3+2],palette[f],-1,-1,normal,material);}
    }

    panel(points, band=0) {
      const top=band/4,bottom=(band+1)/4;
      const uv=[[0,bottom],[1,bottom],[1,top],[0,top]];
      const normal=normalize(cross(points[1].map((v,i)=>v-points[0][i]),points[2].map((v,i)=>v-points[0][i])));
      for(const i of [0,1,2,0,2,3])this.vertex(...points[i],[1,1,1],...uv[i],normal);
    }
    triangle(a,b,c,hex,material=0,normals=null) {
      const normal=normals?null:normalize(cross(b.map((v,i)=>v-a[i]),c.map((v,i)=>v-a[i])));
      const color=rgb(hex);[a,b,c].forEach((p,i)=>this.vertex(...p,color,-1,-1,normals?normals[i]:normal,material));
    }
    quad(points,hex,material=0,normal=null) {const ns=normal?Array(3).fill(normal):null;this.triangle(points[0],points[1],points[2],hex,material,ns);this.triangle(points[0],points[2],points[3],hex,material,ns);}
    beveledBox(x,y,z,w,h,d,hex,material=3,r=.1) {
      const half=[w/2,h/2,d/2],center=[x,y,z];
      for(let axis=0;axis<3;axis++)for(const side of [-1,1]){
        const a=(axis+1)%3,b=(axis+2)%3,n=[0,0,0];n[axis]=side;
        const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(pair=>{const p=center.slice();p[axis]+=side*half[axis];p[a]+=pair[0]*(half[a]-r);p[b]+=pair[1]*(half[b]-r);return p;});
        this.quad(points,hex,material,n);
      }
      for(let a=0;a<3;a++)for(let b=a+1;b<3;b++)for(const sa of [-1,1])for(const sb of [-1,1]){
        const k=3-a-b,n=[0,0,0];n[a]=sa;n[b]=sb;
        const points=[[0,-1],[1,-1],[1,1],[0,1]].map(([edge,end])=>{const p=center.slice();p[a]+=sa*(half[a]-(edge?r:0));p[b]+=sb*(half[b]-(edge?0:r));p[k]+=end*(half[k]-r);return p;});
        this.quad(points,hex,material,normalize(n));
      }
      for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
        const signs=[sx,sy,sz],points=[0,1,2].map(axis=>center.map((v,i)=>v+signs[i]*(half[i]-(axis===i?0:r))));
        this.triangle(...points,hex,material,Array(3).fill(normalize(signs)));
      }
    }
    beam(a,b,r,hex,material=5) {
      const direction=normalize(b.map((v,i)=>v-a[i]));
      const u=normalize(cross(direction,Math.abs(direction[1])>.9?[1,0,0]:[0,1,0]));const v=cross(direction,u);
      const ring=(p,j)=>p.map((n,i)=>n+r*(u[i]*Math.cos(j*Math.PI/2)+v[i]*Math.sin(j*Math.PI/2)));
      for(let j=0;j<4;j++)this.quad([ring(a,j),ring(b,j),ring(b,j+1),ring(a,j+1)],hex,material);
    }
    cylinder(x,y,z,r,length,hex,axis='x',rotation=0,material=5,segments=16) {
      const p=(a,t)=>axis==='x'?[x+t,y+r*Math.cos(a),z+r*Math.sin(a)]:[x+r*Math.cos(a),y+t,z+r*Math.sin(a)];
      const n=a=>axis==='x'?[0,Math.cos(a),Math.sin(a)]:[Math.cos(a),0,Math.sin(a)];
      for(let j=0;j<segments;j++){
        const a=j*Math.PI*2/segments+rotation,b=(j+1)*Math.PI*2/segments+rotation;
        const p1=p(a,-length/2),p2=p(b,-length/2),p3=p(b,length/2),p4=p(a,length/2);
        this.triangle(p1,p2,p3,hex,material,[n(a),n(b),n(b)]);this.triangle(p1,p3,p4,hex,material,[n(a),n(b),n(a)]);
        for(const side of [-1,1])this.triangle(axis==='x'?[x+side*length/2,y,z]:[x,y+side*length/2,z],p(a,side*length/2),p(b,side*length/2),hex,material,Array(3).fill(axis==='x'?[side,0,0]:[0,side,0]));
      }
    }
    softDisc(x,y,z,w,d,hex,material=9) {
      const pts=[[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2]],uv=[[0,0],[1,0],[1,1],[0,1]],color=rgb(hex);
      for(const i of [0,1,2,0,2,3])this.vertex(...pts[i],color,...uv[i],[0,1,0],material);
    }
    ramp(x,z) {
      const w=3.2,h=1.1;
      this.quad([[x-w,.08,z-9],[x+w,.08,z-9],[x+w,h,z],[x-w,h,z]],'#667578',5);
      for(const side of [-1,1])this.triangle([x+side*w,.08,z-9],[x+side*w,.08,z],[x+side*w,h,z],'#384a4b');
      this.quad([[x-w,.08,z],[x+w,.08,z],[x+w,h,z],[x-w,h,z]],'#42565b',5);
      for(const side of [-1,1])this.beam([x+side*3,.14,z-9],[x+side*3,h+.07,z],.06,'#5de1dc',7);
      for(let k=0;k<3;k++){
        const zz=z-7+k*2,yy=.08+(zz-z+9)/9*h;
        this.beam([x-1.25,yy+.025,zz-.45],[x,yy+.095,zz+.35],.09,'#f2d879');
        this.beam([x+1.25,yy+.025,zz-.45],[x,yy+.095,zz+.35],.09,'#f2d879');
      }
    }
    fence(x,travel) {
      // Behind both spectator rows: wire mesh, concrete sill, razor coils and barbs.
      const start=-30+(travel%10);
      this.box(x,.15,80,.5,.3,235,'#a4aca7');
      for(let z=start;z<205;z+=10){
        this.box(x,2.6,z,.16,5.2,.16,'#586864',0,5);
        for(const y of [.8,2.5,4.5])this.beam([x,y,z],[x,y,z+10],.025,'#82918a');
        for(let j=0;j<5;j++){
          const zz=z+j*2;
          this.beam([x,.35,zz],[x,4.6,zz+2],.018,'#83948c');this.beam([x,4.6,zz],[x,.35,zz+2],.018,'#83948c');
          let last=[x+.42,5.25,zz];
          for(let k=1;k<=8;k++){
            const a=k*Math.PI*2/8,next=[x+.42*Math.cos(a),5.25+.42*Math.sin(a),zz+k/8*2];
            this.beam(last,next,.025,'#4b5e56');last=next;
            if(k%4===0){this.beam([next[0]-.15,next[1]-.14,next[2]-.1],[next[0]+.15,next[1]+.14,next[2]+.1],.023,'#a1aca1');}
          }
        }
      }
    }
    barredWindow(x,y,z,w=1.3,h=1.7) {
      this.box(x,y,z,w+.22,h+.22,.17,'#bec9c7');this.box(x,y,z-.11,w,h,.04,'#243747');
      for(let i=-1;i<=1;i++)this.box(x+i*w/4,y,z-.15,.055,h,.05,'#81989d');
      this.box(x,y,z-.15,w,.055,.05,'#81989d');
    }
    person(x,y,z,uniform,variant=0,spectator=false,camo=false) {
      const b=(xx,yy,zz,w,h,d,c)=>this.box(x+xx,y+yy,z+zz,w,h,d,c);
      b(0,1.12,0,.65,.83,.4,uniform); b(0,1.86,0,.46,.46,.42,['#edc19b','#bd875f','#f5d4ab','#a26b50'][variant%4]);
      b(0,2.13,0,.6,.18,.57,uniform);b(0,2.05,.15,.65,.08,.55,uniform);
      b(-.19,.39,0,.22,.65,.3,uniform);b(.19,.39,0,.22,.65,.3,uniform);
      if(!spectator){b(-.47,1.12,0,.2,.75,.26,uniform);b(.47,1.12,0,.2,.75,.26,uniform);}
      if(camo){
        const shades=['#224675','#689dcc','#3d73ad','#182f52'];
        for(const face of [-1,1]){
          for(let row=0;row<4;row++)for(let col=0;col<3;col++){
            const pattern=(row*5+col*3+variant)%7;
            if(pattern<5)b(-.22+col*.21,.84+row*.17,face*.215,.16,.13,.035,shades[pattern%4]);
          }
          for(const side of [-1,1]){
            b(side*.19,.28,face*.165,.19,.16,.035,shades[(variant+1)%4]);
            b(side*.19,.53,face*.165,.16,.12,.035,shades[(variant+2)%4]);
            b(side*.47,1.2,face*.145,.17,.16,.035,shades[(variant+3)%4]);
          }
          b(-.13,2.14,face*.295,.22,.13,.035,shades[(variant+2)%4]);
        }
      }else b(0,1.21,-.215,.66,.1,.025,spectator?'#9ccee2':'#f7faf8');
      b(.16,1.42,-.23,.13,.15,.04,'#ffdc78');
    }
    car(car,player,time,reduced) {
      const x=(480-car.x)/18,z=(car.d-player.d)*.6,yaw=car.yaw||0;
      if(z < -25 || z > 180)return;
      const lift=(car.height||0)+(car.rampLift||0),jump=car.airborne;
      this.softDisc(x,.115,z,4.7+lift*.5,9.7+lift*.8,'#17242c',9);
      if(jump)this.softDisc(x,.13,z,7.7,13,'#79dbea',10);
      const roll=car.roll||0,pitch=car.pitch||0;
      this.model={x,y:lift+(car.suspension||0),z,cy:Math.cos(yaw),sy:Math.sin(yaw),cr:Math.cos(roll),sr:Math.sin(roll),cp:Math.cos(pitch),sp:Math.sin(pitch)};
      const point=(xx,yy,zz)=>[xx,yy,zz];
      const b=(xx,yy,zz,w,h,d,color,material=0)=>this.box(xx,yy,zz,w,h,d,color,0,material);
      const paint=jump?11:car.impact>.35&&!reduced?12:3,rotation=car.d*.6/.59;
      for(const xx of [-1.55,1.55])for(const zz of [-2.4,2.8]){
        this.cylinder(xx,.64,zz,.59,.5,'#172029','x',rotation,6,18);
        const side=Math.sign(xx),hub=xx+side*.27;
        this.cylinder(hub,.64,zz,.3,.065,'#b5c0c5','x',rotation,5,16);
        this.cylinder(hub+side*.035,.64,zz,.1,.065,'#687d86','x',0,5,12);
        for(let k=0;k<6;k++){const a=rotation+k*Math.PI/3;this.beam([hub+side*.04,.64,zz],[hub+side*.04,.64+.25*Math.cos(a),zz+.25*Math.sin(a)],.035,'#435560');}
        b(xx*.85,1.19,zz,.2,.25,1.38,'#25353e');
      }
      b(0,.97,0,3.05,.6,8,'#263842');
      // Tall enclosed prisoner compartment, separate forward cab and rear doors.
      this.beveledBox(0,2.04,-1.12,3.04,2.8,5.1,car.color,paint,.07);b(0,3.47,-1.12,3.2,.18,5.2,'#ccd1cd',5);
      this.beveledBox(0,1.74,2.31,2.94,2,1.78,car.color,paint,.16);this.beveledBox(0,1.26,3.61,2.94,.75,.86,car.color,paint,.12);
      this.quad([[-1.3,1.9,3.39],[1.3,1.9,3.39],[1.3,2.62,3.04],[-1.3,2.62,3.04]],'#244c62',4);
      this.beam([0,1.9,3.43],[0,2.64,3.07],.035,'#b0bcbf');
      for(const side of [-1,1]){
        this.beam([side*1.43,2.2,2.97],[side*1.83,2.27,2.97],.045,'#667881');
        b(side*1.87,2.27,2.97,.14,.45,.42,'#283d49');b(side*1.95,2.27,2.97,.025,.34,.32,'#7192a5',4);
        b(side*.85,1.35,4.065,.62,.25,.07,'#fff3c5',7);
      }
      for(let k=0;k<4;k++)b(0,.98+k*.08,4.074,1.08,.035,.05,'#789198',5);
      b(0,.68,-3.935,.7,.17,.03,'#e4e5d9');b(0,.68,-3.96,.48,.025,.015,'#293941');
      for(let k=0;k<3;k++)b(0,.64+k*.12,-3.88,2.7,.025,.03,'#687b83',5);

      for(const side of [-1,1]){
        b(side*1.48,2.23,2.27,.05,.7,1.36,'#315569',4);b(side*1.54,1.42,-.08,.045,.42,7.54,'#24b970');
        // Small barred compartment windows, rather than passenger glazing.
        b(side*1.54,2.83,-.25,.055,.62,1.05,'#203b4d');
        for(let zz=-.65;zz<=.26;zz+=.3)b(side*1.58,2.83,zz,.055,.65,.05,'#b7c8cb');
        b(side*1.58,2.83,-.22,.055,.055,1.07,'#b7c8cb');
        const xx=side*1.565,z1=side<0?-3.3:.9,z2=side<0?.9:-3.3;
        this.panel([point(xx,1.7,z1),point(xx,1.7,z2),point(xx,2.34,z2),point(xx,2.34,z1)],1);
      }
      b(0,1.42,-3.69,3.05,.42,.055,'#24b970');
      b(0,2.16,-3.71,.08,2.46,.06,'#bacacd');
      for(const xx of [-1.31,1.31]){b(xx,2.17,-3.72,.055,2.46,.045,'#a6b6b8');for(const yy of [1.3,2.8])b(xx,yy,-3.76,.18,.32,.06,'#d6e1e2');}
      for(const xx of [-.35,.35])b(xx,1.97,-3.79,.09,.38,.055,'#d6e1e2');
      this.panel([point(1.26,2.37,-3.79),point(-1.26,2.37,-3.79),point(-1.26,2.94,-3.79),point(1.26,2.94,-3.79)],1);
      b(0,.72,-3.8,3.13,.22,.24,'#becbd0');b(0,.72,4.1,3.13,.22,.24,'#becbd0');
      for(const xx of [-1.08,1.08]){b(xx,1.23,4.05,.62,.29,.06,'#fff1bb');b(xx,1.14,-3.81,.4,.37,.06,'#ff7a6a');}
      b(0,3.65,.82,2.1,.14,.52,'#cddde5');
      const blink=!reduced&&Math.floor(time*6)%2;
      b(-.72,3.83,.82,.6,.24,.49,blink?'#79e1ff':'#237aff',7);b(.72,3.83,.82,.6,.24,.49,blink?'#237aff':'#79e1ff',7);
      if(car.boost>0)for(const xx of [-1,1]){
        b(xx,.57,-4.3,.14,.14,1.1,'#77ebd6',7);this.softDisc(xx,.14,-4.4,1.5,3,'#63dccc',10);
      }
      if(jump){
        for(const side of [-1,1])b(side*1.57,1.04,-.12,.06,.08,7.3,'#9decff',7);
        b(0,1.04,-3.87,3.1,.08,.045,'#c3b2ff',7);
        this.softDisc(0,.18,0,5.5,10.8,'#8f95fb',10);
      }

      if(car.hull<40){b(0,2.55,3.6,.5,.5,.5,'#70808a');b(.15,3.05,3.6,.65,.45,.6,'#91a0a7');}
      this.model=null;
    }
    prison(player,gate) {
      const zOuter=(1340-player.d)*.6,zInner=(1380-player.d)*.6;
      if(zOuter>205)return;
      // Perimeter wall, razor-wire coils, towers, barred accommodation blocks.
      this.box(0,.02,zOuter+64,78,.15,132,'#879690');
      for(const side of [-1,1]){
        this.box(side*38,4.6,zOuter+70,1.2,9.2,150,'#8d9b99');
        this.box(side*24,4.6,zOuter,27,9.2,1.1,'#9eaaa5');
        for(let k=0;k<12;k++){
          this.box(side*38,9.7,zOuter+k*12,.08,1,.08,'#536863');
          this.box(side*38,10.1,zOuter+k*12+5,.08,.07,10,'#536863');
        }
        for(let x=11;x<=37;x+=2){
          this.box(side*x,9.65,zOuter,.045,.06,1.2,'#4d625b',.5);this.box(side*x,9.98,zOuter,.055,.7,.045,'#4d625b');
          this.box(side*x,10.15,zOuter,.045,.06,1.2,'#4d625b',-.5);
        }
        this.box(side*37,6,zOuter+3,3.4,12,3.4,'#7d8d89');this.box(side*37,12.7,zOuter+3,5.1,2.8,5.1,'#647b7d');
        this.box(side*37,14.4,zOuter+3,6.1,.5,6.1,'#465d59');this.box(side*37,12.8,zOuter+.4,3.6,1.35,.12,'#264650');
        this.box(side*37,12.6,zOuter-.1,.5,.55,.9,'#fff0af');
        // Administrative building integrated into the gatehouse.
        this.box(side*20,4.2,zOuter+7,26,8.4,16,'#b5bbb2');this.box(side*20,8.6,zOuter+7,26.7,.5,17,'#657670');
        for(let row=0;row<2;row++)for(let col=0;col<8;col++)this.barredWindow(side*20-10.5+col*3,2.4+row*3.2,zOuter-1.16);
        for(let k=0;k<2;k++){
          this.box(side*23,6,zOuter+43+k*39,20,12,28,'#b7b1a0');this.box(side*23,12.25,zOuter+43+k*39,21,.5,29,'#677770');
          for(let row=0;row<3;row++)for(let col=0;col<6;col++)this.barredWindow(side*23-7.6+col*3,2.5+row*3.2,zOuter+28.8+k*39,1.35,1.8);
        }
        // Sluice side walls and internal safety lights.
        this.box(side*6.55,3.75,(zOuter+zInner)/2,2.1,7.5,26,'#9eaaa5');
        for(let k=0;k<4;k++){this.box(side*5.43,3.1,zOuter+3+k*6,.05,.22,.38,'#ffe3a0');this.box(side*5.44,1.25,zOuter+3+k*6,.07,.11,3,'#dec788');}
      }
      this.box(0,7.75,(zOuter+zInner)/2,15.3,.5,27,'#657670');
      this.box(0,8.65,zOuter-.4,15.3,1.25,.45,'#273a43');
      this.panel([[7.4,8.1,zOuter-.65],[-7.4,8.1,zOuter-.65],[-7.4,9.2,zOuter-.65],[7.4,9.2,zOuter-.65]],2);
      this.box(0,10.25,zOuter-.39,28.7,1.65,.5,'#193249');
      this.panel([[14.2,9.48,zOuter-.65],[-14.2,9.48,zOuter-.65],[-14.2,11.02,zOuter-.65],[14.2,11.02,zOuter-.65]],0);
      this.panel([[30,4.2,zOuter-.61],[17,4.2,zOuter-.61],[17,5.85,zOuter-.61],[30,5.85,zOuter-.61]],3);
      const clamp=v=>Math.max(0,Math.min(1,v));
      const distance=gate.distance;
      const outer=gate.owner?clamp((distance-1320)/10)*(1-clamp((distance-1353)/8)):0;
      const inner=gate.owner?clamp((distance-1363)/10):0;
      for(const [z,open] of [[zOuter,outer],[zInner,inner]]){
        for(const side of [-1,1]){
          const x=side*(2.72+open*5.6);
          this.box(x,2.95,z,5.42,5.8,.35,'#496059');
          for(let k=-2;k<=2;k++)this.box(x+k,2.95,z-.21,.05,5.7,.04,'#90a199');
          this.box(x,1.1,z-.23,5.4,.22,.045,'#d6bd65');
        }
        this.box(-5.3,6.5,z-.3,.3,.4,.4,open>.8?'#82e899':'#ff746e');
      }
      for(let k=0;k<14;k++)this.box(-5.1+k*.8,.1,zInner+9,.8,.07,.7,k%2?'#223c43':'#f2f5e9');
      // Interior courtyard beyond the second door, where the finish is located.
      this.box(0,.13,zInner+33,11,.025,55,'#52635e');
    }
    draw(state) {
      const {player,cars,objects,particles,gate,time,reduced}=state;this.model=null;this.count=0;
      const gl=this.gl;if(gl.isContextLost())return;
      const px=(480-player.x)/18;
      this.box(0,110,280,560,290,2,'#8ab2d0',0,8);
      this.box(0,-.4,100,300,.6,440,'#6e8060',0,2);
      this.box(0,-.04,85,49,.16,285,'#92938a',0,1);
      this.box(0,.045,85,42,.13,285,'#40494e',0,1);
      for(const side of [-1,1])this.box(side*20.4,.122,85,.12,.012,285,'#dedfd4');

      const offset=(player.d*.6)%12;
      for(let z=-30+offset;z<190;z+=12)for(const x of [-12.6,-4.2,4.2,12.6])this.box(x,.124,z,.13,.012,5.5,'#d0d5c9');
      const curbOffset=(player.d*.6)%4;
      for(let z=-30+curbOffset;z<190;z+=4)for(const x of [-21.35,21.35]){this.box(x,.03,z,.5,.15,2,'#e8ede2');this.box(x,.03,z+2,.5,.15,2,'#66736d');}
      for(const side of [-1,1]){
        this.box(side*22.2,1.2,75,.1,.15,220,'#a4bbc2');this.box(side*22.2,.6,75,.1,.13,220,'#a4bbc2');
        for(let z=-30+(player.d*.6)%8;z<190;z+=8)this.box(side*22.2,.7,z,.18,1.55,.2,'#7b919a');
      }
      for(const side of [-1,1])this.fence(side*33.5,player.d*.6);
      const section=Math.floor(player.d/70);
      const uniforms=['#28517a','#4679a3','#315f90','#244369','#6093ad','#367795'];
      for(let k=section-1;k<section+5;k++){
        const z=(k*70-player.d)*.6;if(z < -35 || z > 170 || k*70 > 1280)continue;
        for(const side of [-1,1]){
          for(let row=0;row<2;row++){
            const x=side*(26.5+row*2.5),y=.45+row*.9;
            this.box(x,y/2,z,2.5,y,22,'#526978');this.box(x,y+.06,z,2.5,.13,22,'#78929e');
            for(let col=0;col<6;col++)this.person(x,y+.13,z-9+col*3.5,uniforms[(row*2+col+k+120)%6],col+row,true);
          }
          this.box(side*24.5,2,z-11,.14,4,.14,'#a6c2ca');this.box(side*24.5,3.4,z-10, .12,1.1,2,side<0?'#4298ff':'#ffd55c');
        }
      }
      for(let k=0;k<7;k++){this.box(-65+k*22,8+k%3*3,215,16,16+k%3*6,14,'#849295');}
      for(const side of [-1,1])for(let k=0;k<9;k++){
        const z=k*26-35+(player.d*.6)%26,x=side*(45+(k%3)*8);
        this.cylinder(x,2.4,z,.24,4.8,'#675d49','y',0,0,8);
        this.cylinder(x,5.5,z,2.4,3.4,'#4c6b49','y',0,2,9);
        this.cylinder(x,7.4,z,1.6,2.4,'#567853','y',0,2,9);
      }

      this.prison(player,gate);
      if(player.d<70)for(let k=0;k<21;k++)this.box(-20+k*2,.13,-player.d*.6,2,.01,.8,k%2?'#dedfd4':'#252d31');
      for(const object of objects){
        const z=(object.d-player.d)*.6,x=(480-object.x)/18;if(object.taken||z< -20||z>180)continue;
        if(object.kind==='ramp'){this.ramp(x,z);continue;}
        if(object.kind==='person')this.person(x,0,z,'#151d26',Math.floor(object.d/65));
        else if(object.kind==='employee')this.person(x,0,z,'#315e98',Math.floor(object.d/65),false,true);
        else if(object.kind==='barrier'){
          for(const xx of [-1.9,1.9])this.box(x+xx,.75,z,.25,1.5,.4,'#253442');
          this.box(x,1.25,z,5,.8,.35,'#f8cc6e');for(let xx=-2;xx<2.5;xx+=1)this.box(x+xx,1.25,z-.2,.35,.8,.05,'#273644');
        }else{
          this.box(x,.1,z,1,.2,1,'#243540');this.box(x,.45,z,.65,.55,.65,'#ff975c');this.box(x,.85,z,.35,.25,.35,'#f6f2de');this.box(x,1.1,z,.23,.3,.23,'#ff975c');
        }
      }
      [...cars].sort((a,b)=>b.d-a.d).forEach(car=>this.car(car,player,time,reduced));
      for(const p of particles){
        const z=(p.d-player.d)*.6,x=(480-p.x)/18;if(z< -30||z>180)continue;
        const y=p.y??(.5+(1-p.life/.65)*2);
        if(p.kind==='spark')this.beam([x,y,z],[x-p.vx*.0018,y-p.vy*.025,z-p.vd*.025],.027,p.color,7);
        else if(p.kind==='dust')this.softDisc(x,.15,z,.8,.8,p.color,10);
        else this.box(x,y,z,.13,.13,.13,p.color,0,7);
      }
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.bufferData(gl.ARRAY_BUFFER,this.vertices.subarray(0,this.count),gl.DYNAMIC_DRAW);
      const fov=1.03+(player.boost>0&&!reduced?.06:0);
      const aspect=this.canvas.width/this.canvas.height,back=aspect<1.2?36:27;
      const approach=Math.max(0,Math.min(1,(player.d-1300)/40));
      const shake=reduced?0:(player.impact||0)*.3;
      const eye=[px*.7+Math.sin(time*53)*shake,9.8-5.4*approach+(player.height||0)*.5+Math.cos(time*41)*shake,-back+(back-12)*approach];
      gl.uniform3fv(this.uEye,eye);gl.uniform1f(this.uTravel,player.d*.6);gl.uniform1f(this.uTime,reduced?0:time);
      gl.uniformMatrix4fv(this.uMatrix,false,matrix(eye,[px*.42,1.35+(player.height||0)*.3,24],aspect,fov));
      gl.drawArrays(gl.TRIANGLES,0,this.count/12);
    }
  }
  window.ConvoyRenderer=ConvoyRenderer;
})();
