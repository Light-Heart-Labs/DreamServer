// Original shader by yakovgal on Shadertoy:
// https://www.shadertoy.com/user/yakovgal

const vec3 blue_shift = vec3(1.0, 1.0, 1.0);

uint pcg(uint v)
{
    uint state = v * 747796405u + 2891336453u;
    uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
    return (word >> 22u) ^ word;
}

uvec2 pcg2d(uvec2 v)
{
    v = v * 1664525u + 1013904223u;

    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;

    v = v ^ (v >> 16u);

    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;

    v = v ^ (v >> 16u);

    return v;
}

// http://www.jcgt.org/published/0009/03/02/
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;

    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;

    v ^= v >> 16u;

    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;

    return v;
}

float hash11(float p) {
    return float(pcg(uint(p))) / 4294967296.;
}

vec2 hash21(float p) {
    return vec2(pcg2d(uvec2(p, 0))) / 4294967296.;
}

vec3 hash33(vec3 p3) {
    return vec3(pcg3d(uvec3(p3))) / 4294967296.;
}
vec2 norm(vec2 value, float isPosition) {
    return (value * 2.0 - (iResolution.xy * isPosition)) / iResolution.y;
}

float getSdfRectangle(in vec2 p, in vec2 xy, in vec2 b)
{
    vec2 d = abs(p - xy) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    fragColor = texture(iChannel0, fragCoord.xy / iResolution.xy);

    float elapsed = iTime - iTimeCursorChange;

    float duration = 0.2;
    float fadeInTime = 0.06;
    float fadeOutTime = 0.1;
    float fadeIn = smoothstep(0.0, fadeInTime, elapsed);
    float fadeOut = 1.0 - smoothstep(duration - fadeOutTime, duration, elapsed);
    float fade = clamp(fadeIn * fadeOut, 0.0, 1.0);

    vec2 center = norm(iCurrentCursor.xy, 1.);
    vec2 vu = norm(fragCoord, 1.);
    float v1v = sin(vu.x * 10.0 + iTime);
    float v2v = sin(vu.y * 10.0 + iTime * 4.5);
    float v3v = sin((vu.x + vu.y) * 10.0 + iTime * 0.5);
    float v4v = sin(length(vu) * 10.0 + iTime * 2.0);

    float plasma = (v1v + v2v + v3v + v4v) / 4.0;
    vec3 base_color = vec3(
            0.5 + 0.5 * sin(plasma * 6.28 + 0.0),
            0.5 + 0.5 * sin(plasma * 6.28 + 2.09),
            0.5 + 0.5 * sin(plasma * 6.28 + 4.18)
        );
    float c0 = 0., c1 = 0.;

    // === Configuration Constants ===
    const float TOTAL_PARTICLES = 20.0; // default 50
    const float PARTICLE_SEPARATION = 20.0; // default 20
    const float RANDOM_SEED_OFFSET = 50.0; // default 50
    const float TIME_MULTIPLIER = 5.0; // Default 5
    const float TWO_PI = 6.283185; // 2 * PI
    const float GAUSSIAN_SCALE = -2.0; // default -2.0
    const float COLOR_INTENSITY = 4.0; // default 4.0
    const float COLOR_FADE_FACTOR = 0.3; // default 0.3

    for (float i = 0.; i < TOTAL_PARTICLES; ++i) {
        float t = TIME_MULTIPLIER * iTime + hash11(i);
        vec2 v = hash21(i + RANDOM_SEED_OFFSET * floor(t));
        t = fract(t);
        v = vec2(sqrt(GAUSSIAN_SCALE * log(1. - v.x)), TWO_PI * v.y);
        v = PARTICLE_SEPARATION * v.x * vec2(cos(v.y), sin(v.y));

        vec2 p = center + t * v - fragCoord;
        p.x = p.x + iCurrentCursor.x + iCurrentCursor.z * 0.5;
        p.y = p.y + iCurrentCursor.y - iCurrentCursor.w * 0.5;
        c0 += COLOR_INTENSITY * (1. - t) / (1. + COLOR_FADE_FACTOR * dot(p, p));

        p = p.yx;
        v = v.yx;
        p = vec2(
                p.x / v.x,
                p.y - p.x / v.x * v.y
            );
    }

    vec2 offsetFactor = vec2(-.5, 0.5);

    // Normalization for cursor position and size;
    // cursor xy has the postion in a space of -1 to 1;
    // zw has the width and height
    vec4 currentCursor = vec4(norm(iCurrentCursor.xy, 1.), norm(iCurrentCursor.zw, 0.));
    vec4 previousCursor = vec4(norm(iPreviousCursor.xy, 1.), norm(iPreviousCursor.zw, 0.));
    float sdfCurrentCursor = getSdfRectangle(vu, currentCursor.xy - (currentCursor.zw * offsetFactor), currentCursor.zw * 0.5);
    // vec3 rgb = c0 * base_color + c1 * base_color * blue_shift;
    // rgb += hash33(vec3(fragCoord, iTime * 256.)) / 512.;
    // rgb = pow(rgb, vec3(0.4545));
    //
    // // Apply fade factor
    // rgb *= fade;
    //
    // fragColor = mix(vec4(rgb, 1.), fragColor, 0.5);
    vec3 rgb = c0 * base_color + c1 * base_color * blue_shift;
    rgb += hash33(vec3(fragCoord, iTime * 256.)) / 512.;
    //rgb = pow(rgb, vec3(0.4545));

    float mask = clamp(c0 * 0.2, 0.0, 1.0) * fade;

    // fragColor = mix(fragColor, vec4(rgb, 1.0), mask);
    vec4 newColor = fragColor + vec4(rgb * mask, 1.0); // additive
    // newColor = mix(newColor, fragColor, step(sdfCurrentCursor, 0.));
    fragColor = min(newColor, 1.0); // clamp
}
