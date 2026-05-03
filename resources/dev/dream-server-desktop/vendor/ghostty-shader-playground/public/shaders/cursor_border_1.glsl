
float getSdfRectangle(in vec2 point, in vec2 center, in vec2 halfSize)
{
    vec2 d = abs(point - center) - halfSize;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Normalize a position from pixel space (0..iResolution.xy) to aspect-corrected space (-1..1)
vec2 normalizePosition(vec2 pos) {
    vec2 p = (pos / iResolution.xy) * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;
    return p;
}

// Normalize a size (width, height in pixels) to aspect-corrected space
vec2 normalizeSize(vec2 size) {
    vec2 s = size / iResolution.xy;
    s.x *= iResolution.x / iResolution.y;
    return s * 2.;
}

float normalizeValue(float value) {
    float normalizedBorderWidth = value / iResolution.y;
    return normalizedBorderWidth * 2.0;
}

vec2 OFFSET = vec2(0.5, -0.5);
void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    fragColor = texture(iChannel0, fragCoord.xy / iResolution.xy);
    // Normalization for fragCoord to a space of -1 to 1;
    vec2 vu = normalizePosition(fragCoord.xy);

    float v1v = sin(vu.x * 10.0 + iTime);
    float v2v = sin(vu.y * 10.0 + iTime * 4.5);
    float v3v = sin((vu.x + vu.y) * 10.0 + iTime * 0.5);
    float v4v = sin(length(vu) * 10.0 + iTime * 2.0);

    float plasma = (v1v + v2v + v3v + v4v) / 4.0;
    vec4 color = vec4(
            0.5 + 0.5 * sin(plasma * 6.28 + 0.0),
            0.5 + 0.5 * sin(plasma * 6.28 + 2.09),
            0.5 + 0.5 * sin(plasma * 6.28 + 4.18),
            1.
        );

    vec4 normalizedCursor = vec4(normalizePosition(iCurrentCursor.xy), normalizeSize(iCurrentCursor.zw));
    vec2 rectCenterPx = iCurrentCursor.xy + iCurrentCursor.zw * OFFSET;

    float sdfCurrentCursor = getSdfRectangle(vu, normalizePosition(rectCenterPx), normalizedCursor.zw * 0.5);

    vec4 newColor = mix(fragColor, color, smoothstep(normalizeValue(4.), 0.0, sdfCurrentCursor));
    newColor = mix(newColor, fragColor, step(sdfCurrentCursor, 0.));
    fragColor = newColor;
}
