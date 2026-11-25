`timescale 1ns/1ps

// Testbench auto-verifiant du MAC + ReLU.
// Les vecteurs et les valeurs attendues doivent rester identiques a
// vectors.py (A, B) et au modele Python (mac_relu_model).

module tb_mac_relu;

localparam N = 8;

reg clk;
reg reset = 0;
reg signed [7:0] a = 0;
reg signed [7:0] b = 0;

wire signed [31:0] acc;
wire signed [31:0] relu_out;

mac_relu uut (
    .clk(clk),
    .reset(reset),
    .a(a),
    .b(b),
    .acc(acc),
    .relu_out(relu_out)
);

// Horloge de periode 10 ns
initial clk = 0;
always #5 clk = ~clk;

// Vecteurs d'entree
reg signed [7:0]  va [0:N-1];
reg signed [7:0]  vb [0:N-1];
// Valeurs attendues (ACC cumule et ReLU)
reg signed [31:0] acc_attendu  [0:N-1];
reg signed [31:0] relu_attendu [0:N-1];

integer i;
integer errors = 0;

initial begin
    va[0] = -3;   vb[0] = 4;
    va[1] = 2;    vb[1] = 3;
    va[2] = 5;    vb[2] = 4;
    va[3] = -2;   vb[3] = 3;
    va[4] = -128; vb[4] = -128;
    va[5] = 127;  vb[5] = 127;
    va[6] = 0;    vb[6] = 5;
    va[7] = -128; vb[7] = 1;

    acc_attendu[0] = -12;    relu_attendu[0] = 0;
    acc_attendu[1] = -6;     relu_attendu[1] = 0;
    acc_attendu[2] = 14;     relu_attendu[2] = 14;
    acc_attendu[3] = 8;      relu_attendu[3] = 8;
    acc_attendu[4] = 16392;  relu_attendu[4] = 16392;
    acc_attendu[5] = 32521;  relu_attendu[5] = 32521;
    acc_attendu[6] = 32521;  relu_attendu[6] = 32521;
    acc_attendu[7] = 32393;  relu_attendu[7] = 32393;
end

initial begin
    $dumpfile("relu_simulation.vcd");
    $dumpvars(0, tb_mac_relu);

    // Reset asynchrone
    reset = 1;
    #1;
    if (acc !== 32'sd0 || relu_out !== 32'sd0) begin
        $display("ERREUR reset : acc=%0d relu=%0d", acc, relu_out);
        errors = errors + 1;
    end
    reset = 0;

    // Cycles de calcul
    for (i = 0; i < N; i = i + 1) begin
        @(negedge clk);
        a = va[i];
        b = vb[i];
        @(posedge clk);
        #1;
        if (acc !== acc_attendu[i] || relu_out !== relu_attendu[i]) begin
            $display("ERREUR cycle %0d : a=%0d b=%0d ACC=%0d (attendu %0d) ReLU=%0d (attendu %0d)",
                     i + 1, a, b, acc, acc_attendu[i], relu_out, relu_attendu[i]);
            errors = errors + 1;
        end else begin
            $display("Cycle %0d : a=%0d b=%0d ACC=%0d ReLU=%0d - OK",
                     i + 1, a, b, acc, relu_out);
        end
    end

    // Reset synchrone de l'accumulateur en cours de calcul
    @(negedge clk);
    reset = 1;
    #1;
    if (acc !== 32'sd0) begin
        $display("ERREUR reset en cours de calcul : ACC=%0d", acc);
        errors = errors + 1;
    end
    reset = 0;

    if (errors == 0)
        $display("RESULTAT : TOUS LES TESTS ONT REUSSI");
    else
        $display("RESULTAT : %0d ERREUR(S)", errors);

    $finish;
end

endmodule
