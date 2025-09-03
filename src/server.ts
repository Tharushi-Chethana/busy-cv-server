// src/server.ts
import { Server } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/server/types';
import * as fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

// 1. Configure Email Transporter (Using Gmail)
const emailUser = process.env.EMAIL_USER;
const emailPass = process.env.EMAIL_PASS;

if (!emailUser || !emailPass) {
  console.error('ERROR: EMAIL_USER and EMAIL_PASS environment variables must be set.');
  process.exit(1);
}

// FIXED: Changed createTransporter to createTransport
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: emailUser,
    pass: emailPass,
  },
});

// 2. CV Parsing & LLM Interaction Function
async function askLLMAboutCV(question: string, cvText: string): Promise<string> {
  const openAiApiKey = process.env.OPENAI_API_KEY;

  if (openAiApiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `Answer based only on this CV: ${cvText.substring(0, 3000)}...`
            },
            {
              role: 'user',
              content: question
            }
          ],
          max_tokens: 250,
        }),
      });

      const data = await response.json();
      return data.choices[0]?.message?.content || 'No answer found.';

    } catch (error) {
      console.error('OpenAI API error:', error);
      return `API error: ${error}`;
    }
  } else {
    return `Simulated response for: "${question}". CV text: ${cvText.substring(0, 100)}...`;
  }
}

// 3. Define the Tools our Server Provides
const tools = [
  {
    name: 'ask_about_cv',
    description: 'Ask questions about my CV/Resume',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Question about the CV',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email notification',
    inputSchema: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Recipient email' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' },
      },
      required: ['recipient', 'subject', 'body'],
    },
  },
];

// 4. Create the MCP Server
const server = new Server(
  {
    name: 'busy-cv-email-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// 5. Handle Tool Listing Request
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools,
}));

// 6. Handle Tool Execution Request - FIXED: Added proper type for 'request'
server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const { name, arguments: args } = request.params;
  let cvText: string = '';

  const getCvText = async (): Promise<string> => {
    if (!cvText) {
      try {
        const dataBuffer = await fs.readFile('./assets/my-cv.pdf');
        const pdfData = await pdfParse(dataBuffer);
        cvText = pdfData.text;
        console.log("CV parsed successfully");
      } catch (error) {
        throw new Error("Could not load CV file at './assets/my-cv.pdf'");
      }
    }
    return cvText;
  };

  try {
    switch (name) {
      case 'ask_about_cv': {
        const question = args.question as string;
        const text = await getCvText();
        const answer = await askLLMAboutCV(question, text);
        return {
          content: [{ type: 'text', text: answer }],
        };
      }

      case 'send_email': {
        const recipient = args.recipient as string;
        const subject = args.subject as string;
        const body = args.body as string;

        const info = await transporter.sendMail({
          from: emailUser,
          to: recipient,
          subject: subject,
          text: body,
        });

        return {
          content: [{ type: 'text', text: `Email sent! ID: ${info.messageId}` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error instanceof Error ? error.message : String(error)}`,
      }],
    };
  }
});

// 7. Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Busy MCP Server is running on stdio...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});