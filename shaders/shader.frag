#version 300 es

precision mediump float;

uniform vec4 u_color;
// Tell is what we are trying to draw is a point or a line
uniform bool u_is_point;

out vec4 frag_color;

// Makes a point round
void round_point() {
    // Get the normalized coordinates of the point sprite (0.0 to 1.0)
    vec2 coord = gl_PointCoord.xy - vec2(0.5);
    // Compute the distance from the center of the point sprite
    float dist = length(coord);
    // If the fragment is outside the radius, discard it
    if (dist > 0.5) {
        discard;
    }
}

void main() {
    if (u_is_point)
        round_point();
    frag_color = u_color;
}