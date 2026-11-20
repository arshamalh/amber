# Quantum gates

A qubit is a unit vector $\alpha|0\rangle + \beta|1\rangle$ with $|\alpha|^2 + |\beta|^2 = 1$.

```python
import numpy as np
H = np.array([[1, 1], [1, -1]]) / np.sqrt(2)
```

See [[Reading Feynman]].
