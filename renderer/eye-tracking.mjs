/** Eye-only texture sampling. Character layers never pass through a deforming mesh. */
const W=1090,H=1443;
const vertex=`attribute vec2 position; varying vec2 uv;
void main(){uv=position;gl_Position=vec4(position*vec2(2.0,-2.0)+vec2(-1.0,1.0),0.0,1.0);}`;
const fragment=`precision highp float; uniform sampler2D image; uniform vec2 gaze; varying vec2 uv;
void main(){
 vec2 p=uv*vec2(1090.0,1443.0);
 float l=1.0-smoothstep(.15,1.0,length((p-vec2(413.0,556.0))/vec2(48.0,61.0)));
 float r=1.0-smoothstep(.15,1.0,length((p-vec2(647.0,519.0))/vec2(57.0,66.0)));
 gl_FragColor=texture2D(image,(p-gaze*vec2(7.0,5.0)*(l+r))/vec2(1090.0,1443.0));
}`;
export function createEyeTracking(){
 const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
 const gl=canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true,depth:false});
 let previous=null,available=false,gaze;
 try{
  if(!gl)throw new Error('WebGL unavailable');
  const compile=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,0,1,1,0,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,gl.createTexture());gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
  for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);
  for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program,'image'),0);gaze=gl.getUniformLocation(program,'gaze');gl.viewport(0,0,W,H);available=true;
 }catch(error){console.warn('Eye tracking unavailable:',error.message);}
 canvas.addEventListener('webglcontextlost',()=>{available=false;});
 return {get available(){return available;},draw(source,look={x:0,y:0},enabled=true){
  if(!enabled||!available||gl.isContextLost()||(!look.x&&!look.y))return source;
  if(previous!==source){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);previous=source;}
  const clamp=value=>Math.max(-1,Math.min(1,Number(value)||0));gl.uniform2f(gaze,clamp(look.x),clamp(look.y));gl.clear(gl.COLOR_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,6);return canvas;
 }};
}
