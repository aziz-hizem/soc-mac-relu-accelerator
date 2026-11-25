
from pathlib import Path
from cocotb_tools.runner import get_runner

# Dossier du projet
projet = Path(__file__).resolve().parent

# Utiliser Icarus Verilog
runner = get_runner("icarus")

# Compiler le circuit
runner.build(
    sources=[projet / "mac_relu.v"],
    hdl_toplevel="mac_relu",
    build_dir=projet / "sim_build",
    timescale=("1ns", "1ps"),
    always=True,
)

# Executer les tests cocotb
runner.test(
    hdl_toplevel="mac_relu",
    test_module="test_mac_relu",
)
