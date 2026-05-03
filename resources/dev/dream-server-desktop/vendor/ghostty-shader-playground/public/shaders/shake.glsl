
vec2 norm(vec2 value, float isPosition) {
    return (value * 2.0 - (iResolution.xy * isPosition)) / iResolution.y;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = fragCoord / iResolution.xy;

    float shakeDuration = 0.5; // seconds
    float timeSinceShake = iTime - iTimeCursorChange;

    vec2 shakeOffset = vec2(0.0);

    if (timeSinceShake >= 0.0 && timeSinceShake < shakeDuration) {
        float intensity = 0.0008; // Adjust shake intensity here

        float decay = 1.0 - (timeSinceShake / shakeDuration);

        shakeOffset.x = sin(iTime * 40.0) * intensity * decay;
        shakeOffset.y = cos(iTime * 35.0) * intensity * decay;
    }

    uv += shakeOffset;

    vec4 color = texture(iChannel0, uv);

    fragColor = color;
}
