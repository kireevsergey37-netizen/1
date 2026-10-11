/* Small WebGL renderer: real perspective, depth-tested voxel geometry, no CDN. */
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
    const f = 1 / Math.tan(fov / 2), near = .2, far = 260;
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
        uniform mat4 uMatrix; varying vec3 vColor; varying vec2 vUV; varying float vDepth;
        void main(){gl_Position=uMatrix*vec4(aPosition,1.0);vColor=aColor;vUV=aUV;vDepth=gl_Position.w;}`);
      const fragment = shader(gl.FRAGMENT_SHADER, `
        precision mediump float; varying vec3 vColor; varying vec2 vUV; varying float vDepth;
        uniform sampler2D uSign;
        void main(){vec3 color=vColor;if(vUV.x>=0.0)color=texture2D(uSign,vUV).rgb;
        float fog=smoothstep(90.0,225.0,vDepth);gl_FragColor=vec4(mix(color,vec3(0.55,0.71,0.8),fog),1.0);}`);
      this.program = gl.createProgram(); gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program));
      gl.deleteShader(vertex); gl.deleteShader(fragment);
      gl.useProgram(this.program); this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      for (const [name, size, offset] of [['aPosition',3,0],['aColor',3,12],['aUV',2,24]]) {
        const location = gl.getAttribLocation(this.program, name); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,size,gl.FLOAT,false,32,offset);
      }
      this.uMatrix = gl.getUniformLocation(this.program,'uMatrix');
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
      gl.uniform1i(gl.getUniformLocation(this.program,'uSign'),0);gl.enable(gl.DEPTH_TEST);gl.clearColor(.55,.71,.8,1);
    }
    vertex(x,y,z,color,u=-1,v=-1) {
      if (this.count + 8 > this.vertices.length) {const bigger=new Float32Array(this.vertices.length*2);bigger.set(this.vertices);this.vertices=bigger;}
      const a=this.vertices;let i=this.count;
      a[i++]=x;a[i++]=y;a[i++]=z;a[i++]=color[0];a[i++]=color[1];a[i++]=color[2];a[i++]=u;a[i++]=v;this.count=i;
    }
    box(x,y,z,w,h,d,hex,yaw=0) {
      let palette=this.colors.get(hex);
      if(!palette){const base=rgb(hex);palette=faces.map(([,shade])=>base.map(v=>Math.min(1,v*shade)));this.colors.set(hex,palette);}
      const c=Math.cos(yaw),s=Math.sin(yaw),corners=this.corners;
      for(let i=0;i<8;i++){
        const xx=cornerX[i]*w/2;
        const yy=cornerY[i]*h/2;
        const zz=(i<4?-1:1)*d/2;
        corners[i*3]=x+xx*c+zz*s;corners[i*3+1]=y+yy;corners[i*3+2]=z-xx*s+zz*c;
      }
      for(let f=0;f<faces.length;f++)for(const i of faces[f][0])this.vertex(corners[i*3],corners[i*3+1],corners[i*3+2],palette[f]);
    }

    panel(points, band=0) {
      const top=band/4,bottom=(band+1)/4;
      const uv=[[0,bottom],[1,bottom],[1,top],[0,top]];
      for(const i of [0,1,2,0,2,3])this.vertex(...points[i],[1,1,1],...uv[i]);
    }
    barredWindow(x,y,z,w=1.3,h=1.7) {
      this.box(x,y,z,w+.22,h+.22,.17,'#bec9c7');this.box(x,y,z-.11,w,h,.04,'#243747');
      for(let i=-1;i<=1;i++)this.box(x+i*w/4,y,z-.15,.055,h,.05,'#81989d');
      this.box(x,y,z-.15,w,.055,.05,'#81989d');
    }
    person(x,y,z,uniform,variant=0,spectator=false) {
      const b=(xx,yy,zz,w,h,d,c)=>this.box(x+xx,y+yy,z+zz,w,h,d,c);
      b(0,1.12,0,.65,.83,.4,uniform); b(0,1.86,0,.46,.46,.42,['#edc19b','#bd875f','#f5d4ab','#a26b50'][variant%4]);
      b(0,2.13,0,.6,.18,.57,uniform);b(0,2.05,.15,.65,.08,.55,uniform);
      b(-.19,.39,0,.22,.65,.3,uniform);b(.19,.39,0,.22,.65,.3,uniform);
      if(!spectator){b(-.47,1.12,0,.2,.75,.26,uniform);b(.47,1.12,0,.2,.75,.26,uniform);}
      b(0,1.21,-.215,.66,.1,.025,spectator?'#9ccee2':'#f7faf8');
      b(.16,1.42,-.23,.13,.15,.04,'#ffdc78');
    }
    car(car,player,time,reduced) {
      const x=(480-car.x)/18,z=(car.d-player.d)*.6,yaw=car.yaw||0;
      if(z < -25 || z > 180)return;
      const c=Math.cos(yaw),s=Math.sin(yaw);
      const point=(xx,yy,zz)=>[x+xx*c+zz*s,yy,z-xx*s+zz*c];
      const b=(xx,yy,zz,w,h,d,color)=>this.box(...point(xx,yy,zz),w,h,d,color,yaw);
      this.box(x,.105,z,3.8,.03,8.6,'#283a43');
      for(const xx of [-1.55,1.55])for(const zz of [-2.4,2.8]){b(xx,.64,zz,.55,1.18,1.18,'#15222c');b(xx*1.04,.64,zz,.05,.55,.55,'#a6b6b8');}
      b(0,.97,0,3.05,.6,8,'#263842');
      // Tall enclosed prisoner compartment, separate forward cab and rear doors.
      b(0,2.04,-1.12,3.04,2.8,5.1,car.color);b(0,3.47,-1.12,3.2,.18,5.2,'#becbd0');
      b(0,1.74,2.31,2.94,2,1.78,car.color);b(0,1.26,3.61,2.94,.75,.86,car.color);
      b(0,2.18,3.215,2.57,.65,.05,'#203b4d');b(0,2.28,3.245,.05,.78,.035,'#a6b6b8');
      for(const side of [-1,1]){
        b(side*1.48,2.23,2.27,.05,.7,1.36,'#203b4d');b(side*1.54,1.42,-.08,.045,.42,7.54,'#27e57b');
        // Small barred compartment windows, rather than passenger glazing.
        b(side*1.54,2.83,-.25,.055,.62,1.05,'#203b4d');
        for(let zz=-.65;zz<=.26;zz+=.3)b(side*1.58,2.83,zz,.055,.65,.05,'#b7c8cb');
        b(side*1.58,2.83,-.22,.055,.055,1.07,'#b7c8cb');
        const xx=side*1.565,z1=side<0?-3.3:.9,z2=side<0?.9:-3.3;
        this.panel([point(xx,1.7,z1),point(xx,1.7,z2),point(xx,2.34,z2),point(xx,2.34,z1)],1);
      }
      b(0,1.42,-3.69,3.05,.42,.055,'#27e57b');
      b(0,2.16,-3.71,.08,2.46,.06,'#bacacd');
      for(const xx of [-1.31,1.31]){b(xx,2.17,-3.72,.055,2.46,.045,'#a6b6b8');for(const yy of [1.3,2.8])b(xx,yy,-3.76,.18,.32,.06,'#d6e1e2');}
      for(const xx of [-.35,.35])b(xx,1.97,-3.79,.09,.38,.055,'#d6e1e2');
      this.panel([point(1.26,2.37,-3.79),point(-1.26,2.37,-3.79),point(-1.26,2.94,-3.79),point(1.26,2.94,-3.79)],1);
      b(0,.72,-3.8,3.13,.22,.24,'#becbd0');b(0,.72,4.1,3.13,.22,.24,'#becbd0');
      for(const xx of [-1.08,1.08]){b(xx,1.23,4.05,.62,.29,.06,'#fff1bb');b(xx,1.14,-3.81,.4,.37,.06,'#ff7a6a');}
      b(0,3.65,.82,2.1,.14,.52,'#cddde5');
      const blink=!reduced&&Math.floor(time*6)%2;
      b(-.72,3.83,.82,.6,.24,.49,blink?'#7ae7ff':'#176eff');b(.72,3.83,.82,.6,.24,.49,blink?'#176eff':'#7ae7ff');
      if(car.boost>0)for(const xx of [-1,1])b(xx,.57,-4.3,.3,.3,1.3,'#78f4d8');
      if(car.hull<40){b(0,2.55,3.6,.5,.5,.5,'#70808a');b(.15,3.05,3.6,.65,.45,.6,'#91a0a7');}
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
      const {player,cars,objects,particles,gate,time,reduced}=state;this.count=0;
      const gl=this.gl;if(gl.isContextLost())return;
      const px=(480-player.x)/18;
      this.box(0,-.35,80,210,.6,400,'#6e9a78');this.box(0,-.05,80,28,.13,250,'#485763');
      const offset=(player.d*.6)%12;
      for(let z=-30+offset;z<190;z+=12)for(const x of [-4.72,4.72])this.box(x,.03,z,.16,.025,5.5,'#d0d9d3');
      const curbOffset=(player.d*.6)%4;
      for(let z=-30+curbOffset;z<190;z+=4)for(const x of [-14.15,14.15]){this.box(x,.03,z,.5,.15,2,'#e8ede2');this.box(x,.03,z+2,.5,.15,2,'#ed7778');}
      for(const side of [-1,1]){
        this.box(side*15.1,1.2,75,.1,.15,220,'#a4bbc2');this.box(side*15.1,.6,75,.1,.13,220,'#a4bbc2');
        for(let z=-30+(player.d*.6)%8;z<190;z+=8)this.box(side*15.1,.7,z,.18,1.55,.2,'#7b919a');
      }
      const section=Math.floor(player.d/70);
      const uniforms=['#28517a','#4679a3','#315f90','#244369','#6093ad','#367795'];
      for(let k=section-1;k<section+5;k++){
        const z=(k*70-player.d)*.6;if(z < -35 || z > 170 || k*70 > 1280)continue;
        for(const side of [-1,1]){
          for(let row=0;row<2;row++){
            const x=side*(19.5+row*2),y=.45+row*.9;
            this.box(x,y/2,z,2.5,y,22,'#526978');this.box(x,y+.06,z,2.5,.13,22,'#78929e');
            for(let col=0;col<6;col++)this.person(x,y+.13,z-9+col*3.5,uniforms[(row*2+col+k+120)%6],col+row,true);
          }
          this.box(side*18,2,z-11,.14,4,.14,'#a6c2ca');this.box(side*18,3.4,z-10, .12,1.1,2,side<0?'#4298ff':'#ffd55c');
        }
      }
      for(let k=0;k<7;k++){this.box(-65+k*22,8+k%3*3,190,16,16+k%3*6,14,'#65869a');}
      this.prison(player,gate);
      if(player.d<70)this.box(0,.035,-player.d*.6,28,.035,.4,'#d9e5e3');
      for(const object of objects){
        const z=(object.d-player.d)*.6,x=(480-object.x)/18;if(object.taken||z< -20||z>180)continue;
        if(object.kind==='person')this.person(x,0,z,'#151d26',Math.floor(object.d/65));
        else if(object.kind==='barrier'){
          for(const xx of [-1.9,1.9])this.box(x+xx,.75,z,.25,1.5,.4,'#253442');
          this.box(x,1.25,z,5,.8,.35,'#f8cc6e');for(let xx=-2;xx<2.5;xx+=1)this.box(x+xx,1.25,z-.2,.35,.8,.05,'#273644');
        }else{
          this.box(x,.1,z,1,.2,1,'#243540');this.box(x,.45,z,.65,.55,.65,'#ff975c');this.box(x,.85,z,.35,.25,.35,'#f6f2de');this.box(x,1.1,z,.23,.3,.23,'#ff975c');
        }
      }
      [...cars].sort((a,b)=>b.d-a.d).forEach(car=>this.car(car,player,time,reduced));
      for(const p of particles){const z=(p.d-player.d)*.6;if(z> -25&&z<180)this.box((480-p.x)/18,.5+(1-p.life/.65)*2,z,.13,.13,.13,p.color);}
      gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.bufferData(gl.ARRAY_BUFFER,this.vertices.subarray(0,this.count),gl.DYNAMIC_DRAW);
      const fov=.97+(player.boost>0&&!reduced?.06:0);
      gl.uniformMatrix4fv(this.uMatrix,false,matrix([px*.65,8.8-4.4*Math.max(0,Math.min(1,(player.d-1300)/40)),-18+6*Math.max(0,Math.min(1,(player.d-1300)/40))],[px*.4,1.2,24],this.canvas.width/this.canvas.height,fov));
      gl.drawArrays(gl.TRIANGLES,0,this.count/8);
    }
  }
  window.ConvoyRenderer=ConvoyRenderer;
})();
