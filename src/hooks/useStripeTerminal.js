import { useCallback, useRef, useState } from 'react';
import { loadStripeTerminal } from '@stripe/terminal-js';
import {
  stripeFinancialCreateTerminalConnectionToken,
  stripeFinancialCancelTerminalAction,
} from '../services/stripeFinancialApi';

async function discoverReadersBestEffort(terminal, { locationId, readerId }) {
  const configs = [];
  if (locationId) {
    configs.push({ simulated: false, location: locationId, discoveryMethod: 'internet' });
  }
  configs.push({ simulated: false, location: locationId || undefined, discoveryMethod: 'internet' });
  if (locationId) {
    configs.push({ simulated: false, location: locationId, discoveryMethod: 'local' });
  }
  configs.push({ simulated: false, discoveryMethod: 'local' });

  let lastError = null;
  const seen = new Set();

  for (const cfg of configs) {
    const key = JSON.stringify(cfg);
    if (seen.has(key)) continue;
    seen.add(key);

    // eslint-disable-next-line no-await-in-loop
    const discover = await terminal.discoverReaders(cfg);
    if (discover.error) {
      lastError = discover.error;
      continue;
    }
    const readers = discover.discoveredReaders || [];
    if (!readers.length) continue;

    if (readerId) {
      const match = readers.find((r) => r.id === readerId);
      if (match) return { readers, selected: match, method: cfg.discoveryMethod };
    }
    return { readers, selected: readers[0], method: cfg.discoveryMethod };
  }

  if (lastError) {
    throw new Error(lastError.message || 'Could not discover terminal readers');
  }
  throw new Error(
    'No terminal found. Use the same Wi‑Fi as the POS reader, or set Location ID (tml_…) in Settings.',
  );
}

/**
 * Stripe Terminal JS — internet/local discovery, safe cancel, server cancel_action.
 */
export function useStripeTerminal({ franchiseId, locationId, readerId }) {
  const terminalRef = useRef(null);
  const collectAbortRef = useRef(false);
  const collectingActiveRef = useRef(false);
  const paymentIntentIdRef = useRef('');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const [connectedReader, setConnectedReader] = useState(null);

  const ensureTerminal = useCallback(async () => {
    if (terminalRef.current) return terminalRef.current;
    const StripeTerminal = await loadStripeTerminal();
    const terminal = StripeTerminal.create({
      onFetchConnectionToken: async () => {
        const res = await stripeFinancialCreateTerminalConnectionToken({ franchiseId });
        return res.secret;
      },
      onUnexpectedReaderDisconnect: () => {
        setConnectedReader(null);
        collectingActiveRef.current = false;
        setStatus('disconnected');
        setMessage('Reader disconnected.');
      },
    });
    terminalRef.current = terminal;
    return terminal;
  }, [franchiseId]);

  const cancelTerminalOnServer = useCallback(async () => {
    try {
      await stripeFinancialCancelTerminalAction({
        franchiseId,
        readerId,
        paymentIntentId: paymentIntentIdRef.current || undefined,
      });
    } catch {
      /* best effort */
    }
  }, [franchiseId, readerId]);

  const clearReaderAndDisconnect = useCallback(async () => {
    const terminal = terminalRef.current;

    if (collectingActiveRef.current && terminal) {
      try {
        await terminal.cancelCollectPaymentMethod();
      } catch {
        /* no active collection */
      }
      collectingActiveRef.current = false;
    }

    await cancelTerminalOnServer();

    if (terminal) {
      try {
        if (typeof terminal.clearReaderDisplay === 'function') {
          await terminal.clearReaderDisplay();
        }
      } catch {
        /* ignore */
      }
      try {
        if (terminal.getConnectedReader()) {
          await terminal.disconnectReader();
        }
      } catch {
        /* ignore */
      }
    }

    paymentIntentIdRef.current = '';
    setConnectedReader(null);
    setStatus('idle');
    setMessage('');
  }, [cancelTerminalOnServer]);

  const cancelCollection = useCallback(async () => {
    collectAbortRef.current = true;
    setStatus('cancelling');
    setMessage('Closing terminal session…');
    await clearReaderAndDisconnect();
    setStatus('cancelled');
    setMessage('Terminal session closed.');
  }, [clearReaderAndDisconnect]);

  const connectReader = useCallback(async () => {
    if (collectAbortRef.current) {
      throw new Error('cancelled');
    }
    setStatus('connecting');
    setMessage('Discovering terminal (internet / local)…');
    try {
      const terminal = await ensureTerminal();
      const { selected, method } = await discoverReadersBestEffort(terminal, {
        locationId,
        readerId,
      });
      if (collectAbortRef.current) {
        throw new Error('cancelled');
      }

      setMessage(`Connecting via ${method}…`);
      const connect = await terminal.connectReader(selected);
      if (collectAbortRef.current) {
        await clearReaderAndDisconnect();
        throw new Error('cancelled');
      }
      if (connect.error) {
        throw new Error(connect.error.message || 'Connect failed');
      }
      setConnectedReader(connect.reader);
      setStatus('connected');
      setMessage(`Connected to ${connect.reader.label || connect.reader.id}`);
      return connect.reader;
    } catch (e) {
      if (String(e?.message || '').toLowerCase() === 'cancelled') {
        setStatus('cancelled');
        setMessage('Cancelled.');
        throw e;
      }
      setStatus('error');
      const hint =
        'Ensure POS is online, same network as this computer, and Location ID is set in Settings.';
      setMessage(e?.message ? `${e.message} ${hint}` : hint);
      throw e;
    }
  }, [clearReaderAndDisconnect, ensureTerminal, locationId, readerId]);

  const collectDepositOnTerminal = useCallback(
    async (clientSecret, { paymentIntentId } = {}) => {
      collectAbortRef.current = false;
      paymentIntentIdRef.current = paymentIntentId || '';
      setStatus('collecting');
      setMessage('Present card on terminal…');
      try {
        const terminal = await ensureTerminal();
        if (!terminal.getConnectedReader()) {
          await connectReader();
        }
        if (collectAbortRef.current) {
          throw new Error('cancelled');
        }

        collectingActiveRef.current = true;
        const collect = await terminal.collectPaymentMethod(clientSecret);
        collectingActiveRef.current = false;

        if (collectAbortRef.current) {
          await clearReaderAndDisconnect();
          throw new Error('cancelled');
        }
        if (collect.error) {
          const code = collect.error.code || '';
          if (code === 'canceled' || code === 'cancelled') {
            throw new Error('cancelled');
          }
          throw new Error(collect.error.message || 'Collection failed');
        }

        setMessage('Processing on terminal…');
        const process = await terminal.processPayment(collect.paymentIntent);
        if (collectAbortRef.current) {
          await clearReaderAndDisconnect();
          throw new Error('cancelled');
        }
        if (process.error) {
          throw new Error(process.error.message || 'Payment failed');
        }

        await clearReaderAndDisconnect();
        setStatus('success');
        setMessage('Deposit authorized on terminal.');
        return process.paymentIntent;
      } catch (e) {
        collectingActiveRef.current = false;
        if (String(e?.message || '').toLowerCase() === 'cancelled') {
          setStatus('cancelled');
          setMessage('Payment cancelled.');
          throw e;
        }
        setStatus('error');
        setMessage(e?.message || 'Terminal payment failed');
        await clearReaderAndDisconnect();
        throw e;
      }
    },
    [clearReaderAndDisconnect, connectReader, ensureTerminal],
  );

  const disconnect = useCallback(async () => {
    collectAbortRef.current = true;
    await clearReaderAndDisconnect();
  }, [clearReaderAndDisconnect]);

  return {
    status,
    message,
    connectedReader,
    connectReader,
    collectDepositOnTerminal,
    cancelCollection,
    disconnect,
    clearReaderAndDisconnect,
  };
}
