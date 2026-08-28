/**
 * Tests for Black-Scholes option pricing model
 */

import { describe, it, expect } from 'vitest';
import { priceGreeksMarket } from '../math/adapters';
import { normCdf, normPdf } from '../math/norm';

describe('Normal Distribution Functions', () => {
  it('should calculate CDF correctly', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 4);
    expect(normCdf(1)).toBeCloseTo(0.8413, 4);
    expect(normCdf(-1)).toBeCloseTo(0.1587, 4);
    expect(normCdf(2)).toBeCloseTo(0.9772, 4);
  });

  it('should calculate PDF correctly', () => {
    expect(normPdf(0)).toBeCloseTo(0.3989, 4);
    expect(normPdf(1)).toBeCloseTo(0.2420, 4);
    expect(normPdf(-1)).toBeCloseTo(0.2420, 4);
  });
});

describe('Black-Scholes Option Pricing', () => {
  const S = 100; // Spot price
  const K = 100; // Strike price
  const T = 0.25; // Time to expiration (3 months)
  const r = 0.05; // Risk-free rate
  const q = 0.01; // Dividend yield
  const vol = 0.2; // Volatility

  it('should price call options correctly', () => {
    const result = priceGreeksMarket('call', S, K, T, r, q, vol);
    
    expect(result.price).toBeGreaterThan(0);
    expect(result.delta).toBeGreaterThan(0);
    expect(result.delta).toBeLessThan(1);
    expect(result.gamma).toBeGreaterThan(0);
    expect(result.theta).toBeLessThan(0); // Theta is typically negative for long options
    expect(result.vega).toBeGreaterThan(0);
    expect(result.rho).toBeGreaterThan(0);
  });

  it('should price put options correctly', () => {
    const result = priceGreeksMarket('put', S, K, T, r, q, vol);
    
    expect(result.price).toBeGreaterThan(0);
    expect(result.delta).toBeLessThan(0);
    expect(result.delta).toBeGreaterThan(-1);
    expect(result.gamma).toBeGreaterThan(0);
    expect(result.theta).toBeLessThan(0);
    expect(result.vega).toBeGreaterThan(0);
    expect(result.rho).toBeLessThan(0);
  });

  it('should satisfy put-call parity', () => {
    const call = priceGreeksMarket('call', S, K, T, r, q, vol);
    const put = priceGreeksMarket('put', S, K, T, r, q, vol);
    
    // Put-call parity: C - P = S*exp(-qT) - K*exp(-rT)
    const leftSide = call.price - put.price;
    const rightSide = S * Math.exp(-q * T) - K * Math.exp(-r * T);
    
    expect(leftSide).toBeCloseTo(rightSide, 4);
  });

  it('should handle at-the-money options', () => {
    const call = priceGreeksMarket('call', S, S, T, r, q, vol);
    const put = priceGreeksMarket('put', S, S, T, r, q, vol);
    
    // ATM options should have similar prices
    expect(Math.abs(call.price - put.price)).toBeLessThan(1);
  });

  it('should handle in-the-money call options', () => {
    const result = priceGreeksMarket('call', S, S * 0.9, T, r, q, vol);
    
    expect(result.delta).toBeGreaterThan(0.5);
    expect(result.price).toBeGreaterThan(S - K * Math.exp(-r * T)); // Intrinsic value
  });

  it('should handle out-of-the-money call options', () => {
    const result = priceGreeksMarket('call', S, S * 1.1, T, r, q, vol);
    
    expect(result.delta).toBeLessThan(0.5);
  });

  it('should handle zero time to expiration', () => {
    const call = priceGreeksMarket('call', S, K, 0, r, q, vol);
    const put = priceGreeksMarket('put', S, K, 0, r, q, vol);
    
    // At expiration, options should be worth their intrinsic value
    expect(call.price).toBeCloseTo(Math.max(0, S - K), 4);
    expect(put.price).toBeCloseTo(Math.max(0, K - S), 4);
  });

  it('should handle zero volatility', () => {
    const call = priceGreeksMarket('call', S, K, T, r, q, 0);
    const put = priceGreeksMarket('put', S, K, T, r, q, 0);
    
    // With zero volatility, options should be worth their discounted intrinsic value
    const expectedCall = Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T));
    const expectedPut = Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T));
    
    expect(call.price).toBeCloseTo(expectedCall, 4);
    expect(put.price).toBeCloseTo(expectedPut, 4);
  });

  it('should handle high volatility', () => {
    const lowVol = priceGreeksMarket('call', S, K, T, r, q, 0.1);
    const highVol = priceGreeksMarket('call', S, K, T, r, q, 0.5);
    
    // Higher volatility should increase option prices
    expect(highVol.price).toBeGreaterThan(lowVol.price);
    expect(highVol.vega).toBeGreaterThan(lowVol.vega);
  });
});
