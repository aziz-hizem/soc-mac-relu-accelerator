
`timescale 1ns/1ps

module mac_relu (
    input wire clk,
    input wire reset,
    input wire signed [7:0] a,
    input wire signed [7:0] b,
    output reg signed [31:0] acc,
    output wire signed [31:0] relu_out
);

// Produit des deux entrees
wire signed [15:0] produit;

assign produit = a * b;

// Accumulation
always @(posedge clk or posedge reset) begin
    if (reset)
        acc <= 32'sd0;
    else
        acc <= acc + {{16{produit[15]}}, produit};
end

// Fonction d'activation ReLU
assign relu_out = (acc > 0) ? acc : 32'sd0;

endmodule


