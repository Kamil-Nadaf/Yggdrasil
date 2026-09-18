# -*- coding: utf-8 -*-
# @Author: acharlet

'''
Modeling peak frequency - peak flux correlation from internal shock collision
This model assumes constant shock (and downstream) LF, and constant dissipation rate
'''

import numpy as np

def g2_from_au(au):
  '''
  Ratios of downstream L.F. to shock front L.F., squared
  '''

  # R24b (I1), ratio between \Gamma and \Gamma_1
  K = np.sqrt(2)*au / np.sqrt(1 + au*au)

  G21, G34 = relLfac_from_au(au)

  # plug this in R24a eqns (C2) and (C5)
  # use UR approx beta = 1 - 1/(2*Gamma**2)
  qF = 1/(4*G21*K)
  gFS2 = (K*K*qF - 1)/(qF - 1)
  qR = 4*G34*K/au
  gRS2 = (qR - K*K/(au*au))/(qR - 1)
  return gRS2, gFS2

def relLfac_from_au(au):
  '''
  Relative Lorentz factors at each shock front
  '''
  # R24b (I1), ratio between \Gamma and \Gamma_1
  K = np.sqrt(2)*au / np.sqrt(1 + au*au)

  # relative LF in UR regime (Sari & Piran 95, Eq 3)
  G21 = .5 * (1./K + K)
  G34 = .5 * (au/K + K/au)
  return G34, G21

def ratios_RSvFS_from_au(au):
  '''
  Ratios between normalizations of RS and FS
  '''
  G21, G34 = relLfac_from_au(au)
  b21 = np.sqrt(1. - G21**-2)
  b34 = np.sqrt(1. - G34**-2)
  gFS2, gRS2 = g2_from_au(au)

  ratio_T = (gRS2/gFS2)
  fac1 = np.sqrt((G34/G21)*((G21+1)/(G34+1)))
  fac2 = ((G34-1)/(G21-1))**2
  ratio_nu = fac1 * fac2
  ratio_F = fac1 * (b34/b21) / fac2
  return ratio_T, ratio_nu, ratio_F

def tontoff_to_dRR0(au):
  '''
  Proportionality factor between the crossed radius by the shock in units R0
    and the ratio of activity time over off time for the source
  '''
  au2 = au*au
  gFS2, gRS2 = g2_from_au(au)
  K = 2 * ((au2-1)/(au2+1))
  KRS = K / (gRS2 - 2*au/(1+au2))
  KFS = K / (2*au/(1+au2) - gFS2)
  return KRS, KFS

def correlation_model(nu_pks, au, tau, reverse=True):
  '''
  Peak flux vs peak frequency, normalized, from the collision of UR shells
  parameters:
    nu_pks:     normalized peak observed frequency
      type np.ndarray, replace "np.where" by if/else if you prefer a float as input
    au:         a_u, proper velocity contrast
    tau:        tau=t_on,i/t_off, source activity time during emission of shell i 
                  over the time between the emission of the two shells
    reverse:    boolean, True to model contribution from the RS, False for the FS
  '''

  i = 0 if reverse else 1
  # downstream L.F. to shock front L.F. ratio
  g2 = g2_from_au(au)[i]

  # break frequency
  K = tontoff_to_dRR0(au)[i]
  dR = K * tau
  Tf = 1 + g2*dR
  nu_bk = 1/Tf

  # model functions
  rise = (nu_pks >= nu_bk)
  def flux_rise(nu):
    return 1 - nu**3
  def flux_HLE(nu):
    nF_bk = flux_rise(nu_bk)
    return nF_bk * (nu/nu_bk)**3
  nF = np.where(rise, flux_rise(nu_pks), flux_HLE(nu_pks))

  return nF

def peak_model(T, au, tau, reverse=True):
  '''
  Peak frequency and flux at this frequency with observed time T
  T:        tilde{T}, time in observers frame normalized to angular time
  au:       a_u, proper velocity contrast
  tau:      tau_i=t_on,i/t_off, source activity time during emission of shell i
  reverse:  boolean, True to model contribution from the RS, False for the FS
  '''

  i = 0 if reverse else 1
  # downstream L.F. to shock front L.F. ratio
  g2 = g2_from_au(au)[i]

  # break time
  K = tontoff_to_dRR0(au)[i]
  dR = K * tau
  Tf = 1 + g2*dR
  T1f = (1. - g2) + g2 * Tf

  # model functions
  ### rising part
  def nu_rise(x):
    return 1./x
  def nF_rise(x):
    return 1. - 1/x**3
  ### HLE
  nu_f = nu_rise(T1f)
  nF_f = nF_rise(T1f)
  def nu_HLE(x):
    return nu_f/x
  def nF_HLE(x):
    return nF_f/x**3
  
  rise = (T <= Tf)
  T1 = (1. - g2) + g2 * T
  T2 = (1. - g2) + g2 * T / Tf
  nu_pk = np.where(rise, nu_rise(T1), nu_HLE(T2))
  nF_pk = np.where(rise, nF_rise(T1), nF_HLE(T2))
  return nu_pk, nF_pk

def flux_model(nuobs, Tobs, au, tau1, tau4, T0RS, nu0RS, F0RS,
      alphaRS, betaRS, alphaFS=None, betaFS=None, epsrad_FS=1):
  '''
  Spectral model F_{nu_obs}(T_obs), assuming Band function shape for both shocks
  nuobs:    nu_{obs}, observed frequency. Must be numpy array given the definition of S(x)
  Tobs:     T_{obs}, observed time, T = 0 at the beginning of the pulse
  au:       a_u, proper velocity contrast
  taui:     tau_i=t_on,i/t_off, source activity time during emission of shell i
                over the time between the emission of the two shells
  T0RS:     T_{0,RS}, angular time corresponding to the RS at collision radius
  nu0RS:    nu_{0,RS}, peak frequency of the RS contribution, calculated at R0
  F0RS:     F_{0,RS}, flux normalization of the RS
  '''

  # Set FS spectral slopes equals to RS by default
  if alphaFS is None: alphaFS = alphaRS
  if betaFS is None: betaFS = betaRS

  # check if Tobs is an array or a single value
  T_isarr = False
  F_obs = np.zeros(len(nuobs))
  if (type(Tobs) == np.ndarray):
    T_isarr = True
    F_obs = np.zeros((len(Tobs), len(nuobs)))

  # spectral shape (Band function)
  def S(x, alpha, beta):
    b  = alpha-beta
    xb = b/(1+alpha)
    def S_inf(x):
      return np.exp(1+alpha) * x**alpha * np.exp(-x*(1+alpha))
    def S_sup(x):
      return np.exp(1+alpha) * x**beta * xb**b * np.exp(-b)
    return np.where(x<=xb, S_inf(x), S_sup(x))

  # FS normalizations
  ratio_T, ratio_nu, ratio_F = ratios_RSvFS_from_au(au)
  T0FS  = T0RS / ratio_T
  nu0FS = nu0RS / ratio_nu
  F0FS  = epsrad_FS * F0RS / ratio_F

  # RS contribution
  TRS = 1 + Tobs/T0RS
  nupks_RS, nFpks_RS = peak_model(TRS, au, tau4, reverse=True)
  F_RS = np.zeros(F_obs.shape)
  nu_b = nuobs / nu0RS
  for i, (nupk, nFpk) in enumerate(zip(nupks_RS, nFpks_RS)):
    # nupks and nFpks are arrays even if TRS is a float
    Fpk = nFpk/nupk
    x = nu_b/nupk
    F = F0RS * Fpk * S(x, alphaRS, betaRS)
    if T_isarr:
      F_RS[i] = F
    else:
      F_RS = F
  
  # FS contribution
  TFS = 1 + Tobs/T0FS
  nupks_FS, nFpks_FS = peak_model(TFS, au, tau1, reverse=False)
  F_FS = np.zeros(F_obs.shape)
  nu_b = nuobs / nu0FS
  for i, (nupk, nFpk) in enumerate(zip(nupks_FS, nFpks_FS)):
    Fpk = nFpk/nupk
    x = nu_b/nupk
    F = F0FS * Fpk * S(x, alphaFS, betaFS)
    if T_isarr:
      F_FS[i] = F
    else:
      F_FS = F

  # Total
  F_obs = F_RS + F_FS
  return F_obs


  
