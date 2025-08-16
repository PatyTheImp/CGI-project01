import { buildProgramFromSources, loadShadersFromURLS, setupWebGL } from "./libs/utils.js";
import { flatten, vec2, vec4 } from "./libs/MV.js";

// Array with integers from 0 to 59999
const INDEX_ARRAY = Array.from({ length: 60000 }, (_, i) => i);
// Minimum distance between two control point 
const MIN_DIST = 0.05;
// Minimum amount of time the mouse should be pressed (in miliseconds)
const MIN_MD = 250;
// Minimum number of segments in a simple curve
const MIN_SEGMENTS = 1;
// Maximum number of segments in a simple curve
const MAX_SEGMENTS = 50;
// Minimum global speed
const MIN_SPEED = 0;
// Maximum global speed
const MAX_SPEED = 5;

// Curve modes
const BSPLINE_MODE = 0;
const CATMULL_ROM_MODE = 1;
const BEZIER_MODE = 2;

// Visual effects
const NO_EFFECT = 0;
const BIG_PTS = 1;
const PULSING = 2;

var gl;
var canvas;
var aspect;

var draw_program;
var vao;

// Number of segments per simple curve
let nr_of_segments;
// Animation global speed
let global_speed;
// Array of curves
let curves_array;
// If the curves lines are visible on canvas
let lines_are_visible;
// If the sampling points are visible on canvas
let pts_are_visible;
// If the animation movement is on or not
let is_moving; 
let curve_mode;
let visual_effect;

// Distance between two points given it's coordinates
function distance(p1, p2) {
    return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
}

// Class representing a control point
class Point {
    constructor(coords, base_speed) {
        this.coords = coords;
        this.speed = this.calc_speed(base_speed);
    }

    // Calculates the speed of the poit based on the base speed and it's pertubation
    calc_speed(base_speed) {
        let pertubation = Math.cos(Math.random() * 2 * Math.PI) / 100;
        let pt_speed = vec2(0,0);
        pt_speed[0] = (pertubation * .05) + (base_speed[0] * .95);
        pt_speed[1] = (pertubation * .05) + (base_speed[1] * .95);
        return pt_speed;
    }
}

// Class representing a complex curve
class Curve {
    constructor() {
        // Curve control points
        this.control_points = [];
        // Initial distances between a control point and the next
        this.initial_dists = [];
        // Control points coordinates
        this.cp_coords = [];
        // Random color and opacity
        this.color = vec4(Math.random(), Math.random(), Math.random(), Math.random());
        // Random point size between 5 and 20
        this.point_size = 5 + Math.random() * (20 - 5);
        // Random base speed of the curve
        let speedX = Math.cos(Math.random() * 2 * Math.PI) / 200;
        let speedY = Math.cos(Math.random() * 2 * Math.PI) / 200;
        this.base_speed = vec2(speedX, speedY);
        // If the curve is still being edited
        this.is_editing = true;
    }

    // Adds a new control point and the distance between it and the previous one
    add_ctrl_point(p_coords) {
        let p = new Point(p_coords, this.base_speed);
        if (this.control_points.length > 0) {
            let prev_p = this.control_points.at(-1); //last point in array
            let dist = distance(prev_p.coords, p.coords);
            this.initial_dists.push(dist);
        }
        this.control_points.push(p);
        this.cp_coords.push(p.coords);
    }

    apply_speed() {
        // We don't apply speed if the curve is still being edited
        if (this.is_editing)
            return;
        let size = this.control_points.length;
        // For each control  point
        for (let i = 0; i < size; i++) {
            let p = this.control_points[i];
            // Update position by adding speed
            let x = p.coords[0] + (p.speed[0] * global_speed); 
            let y = p.coords[1] + (p.speed[1] * global_speed);
            // Check for boundary collision and reverse speed (bounce effect)
            if (x > 1.0 || x < -1.0) {
                p.speed[0] = -p.speed[0];
                x = p.coords[0] + (p.speed[0] * global_speed);
            } 
            if (y > 1.0 || y < -1.0) {
                p.speed[1] = -p.speed[1];
                y = p.coords[1] + (p.speed[1] * global_speed);
            }
            p.coords[0] = x;
            p.coords[1] = y;
            if (i < size - 1) { //ignore the last point
                let p2 = this.control_points[i+1];
                let init_dist = this.initial_dists[i];
                // Enforce distance constraint between the points
                this.dist_constraint(p, p2, init_dist);
            } 
            this.cp_coords[i] = p.coords;
        }
    }

    // Function to enforce the distance constraint between two points
    dist_constraint(p1, p2, init_dist) {
        const new_dist = distance(p1.coords, p2.coords);
        // If the distance differs too much from the initial distance, adjust the points
        if (new_dist !== init_dist) {
            const difference = init_dist - new_dist;
            const direction = [
                (p2.coords[0] - p1.coords[0]) / new_dist,
                (p2.coords[1] - p1.coords[1]) / new_dist
            ];
            // Adjust coordinates to maintain the distance
            p1.coords[0] -= direction[0] * (difference / 2);
            p1.coords[1] -= direction[1] * (difference / 2);
        }
    }
}

/**
 * Resize event handler
 * 
 * @param {*} target - The window that has resized
 */
function resize(target) {
    // Aquire the new window dimensions
    const width = target.innerWidth;
    const height = target.innerHeight;

    // Set canvas size to occupy the entire window
    canvas.width = width;
    canvas.height = height;

    // Set the WebGL viewport to fill the canvas completely
    gl.viewport(0, 0, width, height);
}

function setup(shaders) {
    canvas = document.getElementById("gl-canvas");
    gl = setupWebGL(canvas, { alpha: true });

    // Create WebGL programs
    draw_program = buildProgramFromSources(gl, shaders["shader.vert"], shaders["shader.frag"]);

    // Initialize global variables
    nr_of_segments = 3;
    curves_array = [];
    global_speed = 1;
    lines_are_visible = true;
    pts_are_visible = true;
    curve_mode = BSPLINE_MODE;
    visual_effect = NO_EFFECT;
    is_moving = true;

    let curve = new Curve();
    curves_array.push(curve);
    let md_start; // When a mousedown event starts
    let md_end; // When a mousedown event stops 

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Uint32Array(INDEX_ARRAY), gl.STATIC_DRAW);

    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const a_index = gl.getAttribLocation(draw_program, "index");
    gl.vertexAttribIPointer(a_index, 1, gl.INT, false, 0, 0);
    gl.enableVertexAttribArray(a_index);

    // Enable Alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Handle resize events 
    window.addEventListener("resize", (event) => {
        resize(event.target);
    });


    function get_pos_from_mouse_event(canvas, event) {
        const rect = canvas.getBoundingClientRect();
        const x = (event.clientX - rect.left) / canvas.width * 2 - 1;
        const y = -((event.clientY - rect.top) / canvas.height * 2 - 1);

        return vec2(x, y);
    }

    // Handle mouse down events
    canvas.addEventListener("mousedown", (event) => {
        md_start = new Date();
        curve.add_ctrl_point(get_pos_from_mouse_event(canvas, event))
        // Starts collecting points until the mouse goes up
        canvas.addEventListener("mousemove", point_collection);
    });

    // Handle keyboard events
    window.addEventListener('keydown', (event) => {
        if (event.key === 'z' || event.key === 'Z') {
            stop_editing();
        }
        if (event.key === 'c' || event.key === 'C') {
            clean_canvas();
        }
        if (event.key === '+') {
            add_segment();
        }
        if (event.key === '-') {
            sub_segment();
        }
        if (event.key === '<') {
            speed_down();
        }
        if (event.key === '>') {
            speed_up();
        }
        if (event.key === ' ') {
            stop_resume_anim();
        }
        if (event.key === 'p' || event.key === 'P') {
            hide_show_pts();
        }
        if (event.key === 'l' || event.key === 'L') {
            hide_show_lines();
        }
    });

    // Handle mouse up events
    canvas.addEventListener("mouseup", (event) => {
        md_end = new Date();
        let delta = md_end - md_start;
        // Stops collecting points
        canvas.removeEventListener("mousemove", point_collection);
        //Ends curve edition if the amount of time the mouse was pressed is enough
        if (delta > MIN_MD)
            stop_editing();
    });

    // Lateral panel

    //Clean button
    document.getElementById("btn_clean").addEventListener("click", function() {
        clean_canvas();
        this.blur(); //removes focus from the element
      });

    // Stop/resume animation button
    let btn_stop_resume = document.getElementById("btn-stop-resume");
    btn_stop_resume.innerHTML = "Stop animation";
    btn_stop_resume.addEventListener("click", function() {
        stop_resume_anim();
        this.blur(); //removes focus from the element
    });

    // Hide/show sampling points button
    let btn_hide_show_pts = document.getElementById("btn-hide-show-pts");
    btn_hide_show_pts.innerHTML = "Hide points";
    btn_hide_show_pts.addEventListener("click", function() {
        hide_show_pts();
        this.blur(); //removes focus from the element
    });

    // Hide/show curve button
    let btn_hide_show_lines = document.getElementById("btn-hide-show-lines");
    btn_hide_show_lines.innerHTML = "Hide lines";
    btn_hide_show_lines.addEventListener("click", function() {
        hide_show_lines();
        this.blur(); //removes focus from the element
    });

    // Number of segments display
    document.getElementById("nr-segments").innerHTML = nr_of_segments;
    let seg_slider = document.getElementById("seg-slider");
    seg_slider.addEventListener("input", function(event) {
        nr_of_segments = event.target.value;
        document.getElementById("nr-segments").innerHTML = nr_of_segments;
    });

    // Speed display
    document.getElementById("speed").innerHTML = global_speed;
    let speed_slider = document.getElementById("speed-slider");
    speed_slider.addEventListener("input", function(event) {
        global_speed = event.target.value;
        document.getElementById("speed").innerHTML = global_speed;
    });

    // Curve modes display
    let m = document.getElementById("curve-modes");
    m.addEventListener("change", function() {
        switch (m.selectedIndex) {
            case 0:
                curve_mode = BSPLINE_MODE;
                break;
            case 1:
                curve_mode = CATMULL_ROM_MODE;
                break;
            case 2:
                curve_mode = BEZIER_MODE;
                break;
        }
        this.blur(); //removes focus from the element
    });

    // Special effects display
    let ve = document.getElementById("visual-effects");
    ve.addEventListener("change", function() {
        switch (ve.selectedIndex) {
            case 0:
                visual_effect = NO_EFFECT;
                break;
            case 1:
                visual_effect = BIG_PTS;
                break;
            case 2:
                visual_effect = PULSING;
                break;
        }
        this.blur(); //removes focus from the element
    });

    function point_collection(event) {
        // Get the current point
        let p = get_pos_from_mouse_event(canvas, event);
        // Get the curve's last control point 
        let last_cp = curve.control_points.at(-1);
        // Distance between the points
        let dist = distance(p, last_cp.coords);
        // Only adds the control point if it's distance 
        // to the last control point is at least the minimum 
        if (dist >= MIN_DIST)
            curve.add_ctrl_point(p);     
    }

    // Stops the edition of a curve
    function stop_editing() {
        curve.is_editing = false;
        curve = new Curve();
        curves_array.push(curve);
    }

    // Clean all the curves from the canvas
    function clean_canvas() {
        curves_array = [];
        curve = new Curve();
        curves_array.push(curve);
    }

    // Adds the number of segments in a simple curve by one 
    function add_segment() {
        if (nr_of_segments < MAX_SEGMENTS)
            nr_of_segments++;
        seg_slider.value = nr_of_segments;
        document.getElementById("nr-segments").innerHTML = nr_of_segments;
    }

    // Subtracts the number of segments in a simple curve by one 
    function sub_segment() {
        if (nr_of_segments > MIN_SEGMENTS)
            nr_of_segments--;
        seg_slider.value = nr_of_segments;
        document.getElementById("nr-segments").innerHTML = nr_of_segments;
    }

    // Speeds up the curves on the canvas
    function speed_up() {
        if (is_moving) {
            if (global_speed < MAX_SPEED)
                global_speed += .1;
        }
        speed_slider.value = global_speed;
        document.getElementById("speed").innerHTML = global_speed;
    }

    // Speeds down the curves on the canvas
    function speed_down() {
        if (is_moving) {
            if (global_speed > MIN_SPEED)
                global_speed -= .1;
            else global_speed = 0; // For safety
        }
        speed_slider.value = global_speed;
        document.getElementById("speed").innerHTML = global_speed;
    }

    // Stops or resumes the curves animation
    function stop_resume_anim() {
        is_moving = !is_moving;
        if (is_moving)
            btn_stop_resume.innerHTML = "Stop animation";
        else
            btn_stop_resume.innerHTML = "Resume animation";
    }

    // Hides or shows the sampling points
    function hide_show_pts() {
        pts_are_visible = !pts_are_visible;
        if (pts_are_visible)
            btn_hide_show_pts.innerHTML = "Hide points";
        else
            btn_hide_show_pts.innerHTML = "Show points";
    }

    // Hides or shows the curve lines
    function hide_show_lines() {
        lines_are_visible = !lines_are_visible;
        if (lines_are_visible)
            btn_hide_show_lines.innerHTML = "Hide lines";
        else
            btn_hide_show_lines.innerHTML = "Show lines";
    }

    resize(window);

    gl.clearColor(0.0, 0.0, 0.0, 1);

    // Enable Alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    window.requestAnimationFrame(animate);
}

let last_time;

function animate(timestamp) {
    window.requestAnimationFrame(animate);

    if (last_time === undefined) {
        last_time = timestamp;
    }
    // Elapsed time (in miliseconds) since last time here
    const elapsed = timestamp - last_time;

    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(draw_program);
    gl.bindVertexArray(vao);

    // Uniforms common to all curves
    const u_nr_of_segments = gl.getUniformLocation(draw_program, "u_nr_of_segments");
    gl.uniform1i(u_nr_of_segments, nr_of_segments);
    const u_curve_mode = gl.getUniformLocation(draw_program, "u_curve_mode");
    gl.uniform1i(u_curve_mode, curve_mode);
    const u_effect = gl.getUniformLocation(draw_program, "u_effect");
    gl.uniform1i(u_effect, visual_effect);
    const u_is_point = gl.getUniformLocation(draw_program, "u_is_point");

    // We draw each curve from the curves array
    curves_array.forEach(c => {
        const nr_control_points = c.control_points.length;
        // If the curve has less than 4 control points,don't draw it
        if (nr_control_points < 4)
            return;
        // Uniforms uniques to each curve
        const u_control_points = gl.getUniformLocation(draw_program, "u_control_points");
        gl.uniform2fv(u_control_points, flatten(c.cp_coords));
        const u_color = gl.getUniformLocation(draw_program, "u_color");
        if (visual_effect == PULSING) {
            let randon_color = vec4(Math.random(), Math.random(), Math.random(), Math.random());
            gl.uniform4fv(u_color, flatten(randon_color));
        }
        else
            gl.uniform4fv(u_color, flatten(c.color));
        const u_point_size = gl.getUniformLocation(draw_program, "u_point_size");
        gl.uniform1f(u_point_size, c.point_size);
        
        // Number of sampling points per complex curve to be drawn on canvas
        let nr_of_points;
        // The number of sampling points is different in Bézier curves 
        // since it's sliding window is different
        if (curve_mode == BEZIER_MODE)
            nr_of_points = nr_of_segments * (Math.floor((nr_control_points - 1) / 3)) + 1;
        else
            nr_of_points = nr_of_segments * (nr_control_points - 3) + 1;
        if (nr_of_points < 0) nr_of_points = 0;

        if (pts_are_visible) {
            gl.uniform1i(u_is_point, 1);
            gl.drawArrays(gl.POINTS, 0, nr_of_points);
        }
        if (lines_are_visible) {
            gl.uniform1i(u_is_point, 0);
            gl.drawArrays(gl.LINE_STRIP, 0, nr_of_points);
        }
        if (is_moving)
            c.apply_speed();
    });

    gl.useProgram(null);

    last_time = timestamp;
}

loadShadersFromURLS(["shader.vert", "shader.frag"]).then(shaders => setup(shaders))