// services/smsService.js
import twilio from 'twilio';

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  NODE_ENV
} = process.env;

// Debug: print masked Twilio credentials when not in production to help diagnose auth issues
if (NODE_ENV !== 'production') {
  const maskedSid = TWILIO_ACCOUNT_SID ? `${TWILIO_ACCOUNT_SID.slice(0,4)}...${TWILIO_ACCOUNT_SID.slice(-4)}` : '<missing>';
  const maskedToken = TWILIO_AUTH_TOKEN ? `***${TWILIO_AUTH_TOKEN.slice(-4)}` : '<missing>';
  console.log(`Twilio config - SID: ${maskedSid}, TOKEN: ${maskedToken}, FROM: ${TWILIO_PHONE_NUMBER || '<missing>'}`);
}

const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

const SMS_TEMPLATES = {
  VERIFICATION: (code) => `Your KaamSetu verification code is: ${code}. Valid for 10 minutes.`,
  PASSWORD_RESET: (code) => `Your KaamSetu password reset code is: ${code}. Valid for 10 minutes.`,
  PHONE_UPDATE: (code) => `Your KaamSetu phone update code is: ${code}. Valid for 10 minutes.`
};

export const sendSMS = async (to, type, data) => {
  if (NODE_ENV === 'test') {
    console.log(`[TEST] SMS to ${to}: ${SMS_TEMPLATES[type](data.code)}`);
    return { sid: 'test_sid' };
  }

  try {
    const message = await client.messages.create({
      body: SMS_TEMPLATES[type](data.code),
      from: TWILIO_PHONE_NUMBER,
      to: formatPhoneNumber(to)
    });
    return { sid: message.sid };
  } catch (error) {
    // Preserve the original Twilio error (so callers can inspect error.code etc.)
    console.error('Error sending SMS:', error);
    throw error;
  }
};

const formatPhoneNumber = (phone) => {
  // Add country code if missing
  if (!phone.startsWith('+')) {
    return `+91${phone.replace(/\D/g, '')}`;
  }
  return phone;
};