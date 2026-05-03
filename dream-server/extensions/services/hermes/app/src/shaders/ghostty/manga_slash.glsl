// By Komsit37 (https://github.com/komsit37)

float getSdfRectangle(in vec2 p, in vec2 xy, in vec2 b)
{
    vec2 d = abs(p - xy) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec2 norm(vec2 value, float isPosition) {
    return (value * 2.0 - (iResolution.xy * isPosition)) / iResolution.y;
}

float antialising(float distance) {
    return 1. - smoothstep(0., norm(vec2(2., 2.), 0.).x, distance);
}

vec2 getRectangleCenter(vec4 rectangle) {
    return vec2(rectangle.x + (rectangle.z / 2.), rectangle.y - (rectangle.w / 2.));
}

float ease(float x) {
    return 1.0 - pow(1.0 - x, 3.0); // Smooth cubic ease-out
}

// Smooth noise function for fluid motion
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);

    return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// Water breathing technique - fluid flowing lines
float waterFlow(vec2 p, vec2 start, vec2 end, float time, float seed) {
    vec2 direction = norm(end - start);
    vec2 perpendicular = vec2(-direction.y, direction.x);
    float totalLength = distance(start, end);

    if (totalLength < 0.001) return 0.0;

    vec2 localP = p - start;
    float alongPath = dot(localP, direction);
    float acrossPath = dot(localP, perpendicular);

    // Normalize position along path
    float t = clamp(alongPath / totalLength, 0.0, 1.0);

    // Main water flow line with smooth undulation
    float waveOffset = sin(t * 12.0 + time * 4.0 + seed) * 0.008;
    float mainFlow = 1.0 / (abs(acrossPath - waveOffset) * 200.0 + 0.005);

    // Secondary flowing lines - like water currents
    float flowLines = 0.0;
    for (int i = 0; i < 3; i++) {
        float offset = (float(i) - 1.0) * 0.012;
        float wavePhase = sin(t * 8.0 + time * 3.0 + float(i) + seed) * 0.006;
        float lineIntensity = 0.4 / (abs(acrossPath - offset - wavePhase) * 150.0 + 0.008);

        // Vary intensity smoothly along the path
        float flowStrength = sin(t * 6.0 + float(i) * 2.0) * 0.3 + 0.7;
        flowLines += lineIntensity * flowStrength;
    }

    return mainFlow + flowLines;
}

// Gentle water ripple effect at cursor
float waterRipple(vec2 p, vec2 center, float time, float intensity) {
    float dist = distance(p, center);
    float ripple = sin(dist * 100.0 - time * 8.0) * exp(-dist * 50.0);
    return max(0.0, ripple * intensity);
}

const vec3 WATER_BLUE = vec3(0.3, 0.7, 1.0); // Clear water blue
const vec3 WATER_WHITE = vec3(0.8, 0.9, 1.0); // Water foam white
const vec3 DEEP_BLUE = vec3(0.1, 0.4, 0.8); // Deep water blue
const vec3 CURSOR_COLOR = vec3(0.6, 0.8, 1.0); // Soft blue cursor
const float DURATION = 0.4; // Gentle fade

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    fragColor = texture(iChannel0, fragCoord.xy / iResolution.xy);

    // Normalization for fragCoord to a space of -1 to 1;
    vec2 vu = norm(fragCoord, 1.);
    vec2 offsetFactor = vec2(-.5, 0.5);

    // Normalization for cursor position and size;
    vec4 currentCursor = vec4(norm(iCurrentCursor.xy, 1.), norm(iCurrentCursor.zw, 0.));
    vec4 previousCursor = vec4(norm(iPreviousCursor.xy, 1.), norm(iPreviousCursor.zw, 0.));

    float sdfCurrentCursor = getSdfRectangle(vu, currentCursor.xy - (currentCursor.zw * offsetFactor), currentCursor.zw * 0.5);

    float progress = clamp((iTime - iTimeCursorChange) / DURATION, 0.0, 1.0);
    float easedProgress = ease(progress);

    vec2 centerCC = getRectangleCenter(currentCursor);
    vec2 centerCP = getRectangleCenter(previousCursor);
    float moveDistance = distance(centerCC, centerCP);

    vec4 newColor = vec4(fragColor);

    // Only show water flow effects if there was significant cursor movement
    if (moveDistance > 0.001 && progress < 1.0) {
        float seed = iTimeCursorChange;

        // Main water breathing effect - fluid flowing lines
        float waterEffect = waterFlow(vu, centerCP, centerCC, iTime, seed);

        // Gentle ripple at current cursor position
        float ripple = waterRipple(vu, centerCC, iTime, 1.0 - progress);

        // Fade effects smoothly
        waterEffect *= (1.0 - easedProgress);

        // Apply water colors with gentle intensity
        // Main flow - deep blue to white gradient
        float flowIntensity = clamp(waterEffect * 0.3, 0.0, 1.0);
        newColor = mix(newColor, vec4(DEEP_BLUE, 0.6), flowIntensity * 0.4);
        newColor = mix(newColor, vec4(WATER_BLUE, 0.8), flowIntensity * 0.3);

        // Bright water foam lines
        if (waterEffect > 0.2) {
            float foamIntensity = clamp((waterEffect - 0.2) * 0.5, 0.0, 1.0);
            newColor = mix(newColor, vec4(WATER_WHITE, 0.7), foamIntensity);
        }

        // Subtle ripple effect
        float rippleIntensity = clamp(ripple * 0.2, 0.0, 1.0);
        newColor = mix(newColor, vec4(WATER_BLUE, 0.5), rippleIntensity);
    }

    // Draw current cursor with gentle blue glow
    float cursorGlow = exp(-abs(sdfCurrentCursor) * 40.0) * 0.2;
    newColor = mix(newColor, vec4(CURSOR_COLOR, 0.8), antialising(sdfCurrentCursor));
    newColor = mix(newColor, vec4(WATER_BLUE, 0.4), cursorGlow);

    fragColor = newColor;
}
