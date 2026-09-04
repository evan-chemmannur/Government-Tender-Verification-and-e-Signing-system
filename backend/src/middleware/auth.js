export const requireAuth = (req, res, next) => {
  if (!req.session || !req.session.officerId) {
    return res.status(401).json({ error: 'Not authenticated', redirect: '/auth/login' });
  }

  const { loginAt, lastActivity } = req.session;
  const now = Date.now();
  const THIRTY_MINUTES = 30 * 60 * 1000;

  // Check absolute session expiry or inactivity timeout
  if (now - new Date(loginAt).getTime() > 8 * 60 * 60 * 1000 || // 8 hour absolute max
      (lastActivity && now - lastActivity > THIRTY_MINUTES)) {
    req.session.destroy();
    res.clearCookie('connect.sid');
    return res.status(401).json({ error: 'Session expired', redirect: '/auth/login' });
  }

  req.session.lastActivity = now;

  req.officer = {
    id: req.session.officerId,
    name: req.session.officerName,
    loa: req.session.loa,
    role: req.session.role
  };

  next();
};

export const requireLoA = (requiredLevel) => {
  return (req, res, next) => {
    const currentLoA = req.officer.loa;
    
    let isSufficient = false;
    if (requiredLevel === 'loa2') {
      isSufficient = ['LOA_2_OTP', 'LOA_2_DEMOGRAPHIC', 'LOA_3_BIOMETRIC'].includes(currentLoA);
    } else if (requiredLevel === 'loa3') {
      isSufficient = currentLoA === 'LOA_3_BIOMETRIC';
    }

    if (!isSufficient) {
      return res.status(403).json({ 
        error: 'Insufficient authentication level', 
        requiredLoA: requiredLevel, 
        currentLoA 
      });
    }

    next();
  };
};

export const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.officer.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
};
