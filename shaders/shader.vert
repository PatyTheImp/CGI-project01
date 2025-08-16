#version 300 es

#define MAX_CONTROL_POINTS 256

#define BSPLINE_MODE 0
#define CATMULL_ROM_MODE 1
#define BEZIER_MODE 2

#define BIG_PTS 1

in int index;

uniform int u_nr_of_segments;
uniform int u_curve_mode;
uniform int u_effect;
uniform vec2 u_control_points[MAX_CONTROL_POINTS];
uniform float u_point_size;

float pt_size;

// B-Spline's blending functions
float bSpline(int n, float t) {
    switch(n) {
        case 0:
            return (-pow(t, 3.0f) + 3.0f*pow(t, 2.0f) - 3.0f*t + 1.0f) / 6.0f;
        case 1:
            return (3.0f*pow(t, 3.0f) - 6.0f*pow(t, 2.0f) + 4.0f) / 6.0f;
        case 2:
            return (-3.0f*pow(t, 3.0f) + 3.0f*pow(t, 2.0f) + 3.0f*t + 1.0f) / 6.0f;
        case 3:
            return pow(t, 3.0f) / 6.0f;
    } 
}

// Catmull-Rom's blending functions
float catmullRom(int n, float t) {
    switch(n) {
        case 0:
            return (-pow(t, 3.0f) + 2.0f*pow(t, 2.0f) - t) / 2.0f;
        case 1:
            return (3.0f*pow(t, 3.0f) - 5.0f*pow(t, 2.0f) + 2.0f) / 2.0f;
        case 2:
            return (-3.0f*pow(t, 3.0f) + 4.0f*pow(t, 2.0f) + t) / 2.0f;
        case 3:
            return (pow(t, 3.0f) - pow(t, 2.0f)) / 2.0f;
    } 
}

// Bézier's blending functions
float bezier(int n, float t) {
    switch(n) {
        case 0:
            return -pow(t, 3.0f) + 3.0f*pow(t, 2.0f) - 3.0f*t + 1.0f;
        case 1:
            return 3.0f*pow(t, 3.0f) - 6.0f*pow(t, 2.0f) + 3.0f*t;
        case 2:
            return -3.0f*pow(t, 3.0f) + 3.0f*pow(t, 2.0f);
        case 3:
            return pow(t, 3.0f);
    } 
}

// Apply the curve mode blending function 
vec2 applyFunction(float t, int curve_nr) {
    vec2 pos = vec2(0.0);
    switch(u_curve_mode) {
        case BSPLINE_MODE:
            for (int i = 0; i < 4; i++)
                pos += (bSpline(i,t) * u_control_points[curve_nr+i]);
            break;
        case CATMULL_ROM_MODE:
            for (int i = 0; i < 4; i++)
                pos += (catmullRom(i,t) * u_control_points[curve_nr+i]);
            break;
        case BEZIER_MODE:
            for (int i = 0; i < 4; i++)
                pos += (bezier(i,t) * u_control_points[curve_nr+i]);
            break;
    }
    return pos;
}

int findCurveNr() {
    // The sliding window depends of the curve mode
    if (u_curve_mode == BEZIER_MODE)
        return (index / u_nr_of_segments) * 3;
    return index / u_nr_of_segments;
}

// Find the position of the point
vec2 findPointPos() {
    int curve_nr = findCurveNr();
    pt_size = u_point_size;
    int i = index % u_nr_of_segments;
    float t = float(i) / float(u_nr_of_segments);
    // So the beginning point of simple curves get bigger
    if (u_effect == BIG_PTS && t == 0.0f) 
        pt_size *= 2.0f;
    return applyFunction(t, curve_nr);
}


void main() {
    vec2 point_pos = findPointPos();
    gl_Position = vec4(point_pos, 0.0f, 1.0f);
    gl_PointSize = pt_size;
}