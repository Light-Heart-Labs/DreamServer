#version 300 es
#define WEB 1
#ifdef GL_ES
precision highp float;
precision highp int;
precision mediump sampler3D;
#endif
#define HW_PERFORMANCE 1

uniform vec2 iResolution;
uniform float iTime;
uniform vec4 iCurrentCursor;
uniform vec4 iPreviousCursor;
uniform float iTimeCursorChange;
uniform vec4 iCurrentCursorColor;
uniform vec4 iPreviousCursorColor;
uniform sampler2D iChannel0;

out vec4 fragColor;

//$REPLACE$
void main() {
    mainImage(fragColor, gl_FragCoord.xy);
}
