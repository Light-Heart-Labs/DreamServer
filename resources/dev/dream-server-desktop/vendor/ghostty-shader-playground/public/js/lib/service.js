export async function getShader(name) {
  const response = await fetch(`shaders/${name}`);
  return await response.text();
}
export async function getShaderList() {
  const response = await fetch("/shaders-list");
  return await response.json();
}
export async function getGhosttyWrapper() {
  const response = await fetch("misc/ghostty_wrapper.glsl");
  return await response.text();
}
