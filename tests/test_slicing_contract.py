import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/'backend'))
import slicing_contract as contract


class ToolLayerContracts(unittest.TestCase):
    def heads(self):
        return [{'toolhead':'T'+str(i),'nozzle':.6 if i==1 else .4,'height':.28 if i==1 else .14} for i in range(4)]

    def test_realizable_exact_grid_and_tool_order(self):
        plan=contract.tool_layers(self.heads(),.14)
        self.assertEqual(plan['grid'],.14)
        self.assertEqual([h['every'] for h in plan['heads']],[1,2,1,1])

    def test_unsafe_fallback_grid_and_excessive_height_refused(self):
        for height in [.3,.43,float('nan'),.281]:
            heads=self.heads();heads[1]['height']=height
            with self.assertRaises(ValueError):contract.tool_layers(heads,.14)
        with self.assertRaises(ValueError):contract.tool_layers(self.heads(),.05)

    def test_thick_layer_mode_and_tolerance_are_checked_and_returned(self):
        plan=contract.tool_layers(self.heads(),.14,'adaptive',65)
        self.assertEqual((plan['thick_mode'],plan['thick_tolerance']),('adaptive',65))
        self.assertEqual(contract.tool_layers(self.heads(),.14)['thick_mode'],'fixed')
        for mode,tol in [('wild',80),('fixed',101),('fixed',-1),('fixed','lots'),('fixed',float('nan'))]:
            with self.assertRaises(ValueError):contract.tool_layers(self.heads(),.14,mode,tol)

    def test_deposition_evidence_uses_extrusion_not_travel_or_recovery(self):
        text='M83\nG90\nT0\nG1 X20 Y20 Z.14\n;TYPE:Outer wall\n;HEIGHT:0.14\nG1 X30 E1\nG1 E-1\nG1 Z.21\nG1 X40 E1\nG1 Z.28\nG1 X50 E1\nT1\n;HEIGHT:0.28\nG1 Z.28\nG1 X60 E1\nG1 Z.56\nG1 X70 E1\n'
        data=contract.deposition_evidence(text)['tools']
        self.assertEqual(data[0]['z_steps_mm'],{.14:1})
        self.assertEqual(data[1]['z_steps_mm'],{.28:1})
        self.assertEqual(data[0]['deposition_levels'],2)

    def test_absolute_extrusion_and_g92_reset(self):
        text=';TYPE:Outer wall\nM82\nG1 X20 Y20 Z.2 E1\nG92 E0\nG1 X30 Z.4 E1\nG1 X40 Z.6 E.5\nG1 X50 Z.8 E1\n'
        data=contract.deposition_evidence(text)['tools'][0]
        self.assertEqual(data['deposition_levels'],2)
        self.assertEqual(data['z_steps_mm'],{.2:1})
