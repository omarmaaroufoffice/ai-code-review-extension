import * as vscode from 'vscode';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import * as fs from 'fs';
import * as path from 'path';

interface CodeBlock {
    id: string;
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    type: string;
}

interface FileModification {
    filePath: string;
    blocks: CodeBlock[];
    operation: 'append' | 'modify' | 'insert' | 'delete';
}

class AIConversationPanel {
    public static currentPanel: AIConversationPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private _openai: OpenAI;
    private _conversationHistory: ChatCompletionMessageParam[] = [];
    private _currentIteration: number = 0;
    private _maxIterations: number = 10000;
    private _outputPath: string = '';
    private _codeBlocks: Map<string, CodeBlock> = new Map();
    private _fileModifications: FileModification[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || '',
        });

        // Create output directory for code files
        this._outputPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'generated-code');
        if (!fs.existsSync(this._outputPath)) {
            fs.mkdirSync(this._outputPath, { recursive: true });
        }

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (message: { command: string, codeRequest?: string, iterations?: number }) => {
                switch (message.command) {
                    case 'startConversation':
                        await this._getCodeRequest();
                        break;
                    case 'continueConversation':
                        if (message.codeRequest && message.iterations) {
                            this._maxIterations = message.iterations;
                            await this._startCodeGeneration(message.codeRequest);
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    private async _getCodeRequest() {
        const codeRequest = await vscode.window.showInputBox({
            prompt: 'What code would you like the AIs to generate and review?',
            placeHolder: 'e.g., "Create a REST API with Node.js and Express"'
        });

        const iterations = await vscode.window.showInputBox({
            prompt: 'How many improvement iterations would you like?',
            placeHolder: 'Enter a number (default: 3)',
            validateInput: (value: string) => {
                const num = parseInt(value);
                return (!isNaN(num) && num > 0) ? null : 'Please enter a valid positive number';
            }
        });

        if (codeRequest && iterations) {
            this._panel.webview.postMessage({ 
                command: 'continueConversation', 
                codeRequest,
                iterations: parseInt(iterations)
            });
        }
    }

    private async _saveGeneratedCode(content: string, iteration: number) {
        // Updated regex to better handle JSON metadata blocks
        const codeBlockRegex = /--------------------------------------------------\s*{\s*"file":\s*"([^"]+)",\s*"blockId":\s*"([^"]+)",\s*"startLine":\s*(\d+),\s*"operation":\s*"([^"]+)"\s*}\s*([\s\S]*?)--------------------------------------------------/g;
        let match;

        while ((match = codeBlockRegex.exec(content)) !== null) {
            try {
                const [_, filePath, blockId, startLineStr, operation, code] = match;
                const startLine = parseInt(startLineStr);
                
                if (isNaN(startLine)) {
                    console.warn('Invalid start line:', startLineStr);
                    continue;
                }

                const fullPath = path.join(this._outputPath, filePath);
                const codeBlock: CodeBlock = {
                    id: blockId,
                    filePath: fullPath,
                    startLine,
                    endLine: startLine + code.trim().split('\n').length,
                    content: code.trim(),
                    type: path.extname(filePath).slice(1) || 'txt'
                };

                this._codeBlocks.set(blockId, codeBlock);
                
                await this._handleFileModification({
                    filePath: fullPath,
                    blocks: [codeBlock],
                    operation: operation as 'append' | 'modify' | 'insert' | 'delete'
                });
            } catch (error) {
                console.error('Error processing code block:', error);
                continue;
            }
        }
    }

    private async _handleFileModification(modification: FileModification) {
        const { filePath, blocks, operation } = modification;
        const directory = path.dirname(filePath);
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, { recursive: true });
        }

        let existingContent = '';
        let existingLines: string[] = [];
        
        if (fs.existsSync(filePath)) {
            existingContent = fs.readFileSync(filePath, 'utf-8');
            existingLines = existingContent.split('\n');
        }

        for (const block of blocks) {
            switch (operation) {
                case 'append':
                    if (!existingContent) {
                        fs.writeFileSync(filePath, block.content);
                    } else {
                        fs.appendFileSync(filePath, '\n' + block.content);
                    }
                    break;

                case 'modify':
                    if (block.startLine > 0 && block.endLine <= existingLines.length) {
                        existingLines.splice(
                            block.startLine - 1,
                            block.endLine - block.startLine + 1,
                            block.content
                        );
                        fs.writeFileSync(filePath, existingLines.join('\n'));
                    }
                    break;

                case 'insert':
                    if (block.startLine > 0) {
                        existingLines.splice(block.startLine - 1, 0, block.content);
                        fs.writeFileSync(filePath, existingLines.join('\n'));
                    }
                    break;

                case 'delete':
                    if (block.startLine > 0 && block.endLine <= existingLines.length) {
                        existingLines.splice(
                            block.startLine - 1,
                            block.endLine - block.startLine + 1
                        );
                        fs.writeFileSync(filePath, existingLines.join('\n'));
                    }
                    break;
            }
        }
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (AIConversationPanel.currentPanel) {
            AIConversationPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'aiConversation',
            'AI Code Generation & Review',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        AIConversationPanel.currentPanel = new AIConversationPanel(panel, extensionUri);
    }

    private async _startCodeGeneration(codeRequest: string) {
        try {
            this._currentIteration = 0;
            this._conversationHistory = [];
            
            // Initial code generation
            const generatorPrompt = `You are an expert software developer. Generate code based on the following request. 
            Provide detailed explanations and break down the implementation into multiple files if necessary. 
            Format your response with clear file paths and code blocks using markdown syntax.
            Request: ${codeRequest}`;
            
            await this._generateAndReview(generatorPrompt, codeRequest);
        } catch (error) {
            console.error('Error in AI conversation:', error);
            this._updateWebview('An error occurred during the conversation. Please check your OpenAI API key and try again.');
        }
    }

    private async _generateAndReview(prompt: string, request: string) {
        while (this._currentIteration < this._maxIterations) {
            // Generate code
            const response = await this._generateResponse(
                `You are a code generator AI. ${this._currentIteration === 0 ? prompt : 'Improve the code based on the review feedback.'}
                When generating code, use the following format for code blocks:
                
                --------------------------------------------------
                {
                  "file": "path/to/file",
                  "blockId": "unique_block_id",
                  "startLine": line_number,
                  "operation": "operation_type"
                }
                your code content here
                --------------------------------------------------
                
                Available operations are: append, modify, insert, delete.
                Ensure the JSON metadata block is properly formatted and includes all required fields.
                Use clear blockIds that indicate the purpose of each block.
                `,
                request,
                true
            );

            // Save generated code
            if (response) {
                await this._saveGeneratedCode(response, this._currentIteration);
            }

            // Get code review if not the last iteration
            if (this._currentIteration < this._maxIterations - 1) {
                const reviewPrompt = `You are a code reviewer AI. Review the following code implementation and suggest specific improvements.
                Reference specific code blocks using their blockIds when suggesting changes.
                Format your suggestions using the same code block structure with proper JSON metadata.
                ${response}
                
                Format your review with specific line numbers and block IDs where applicable.`;
                
                const review = await this._generateResponse(reviewPrompt, '', false);
                if (review) {
                    request = `Previous implementation: ${response}\n\nReview feedback: ${review}\n\nPlease implement the suggested improvements using the same code block format with proper JSON metadata.`;
                }
            }

            this._currentIteration++;
        }
    }

    private async _generateResponse(systemPrompt: string, userMessage: string, isGenerator: boolean): Promise<string> {
        const response = await this._openai.chat.completions.create({
            model: "o3-mini",
            messages: [
                { role: "system", content: systemPrompt },
                ...this._conversationHistory,
                { role: "user", content: userMessage }
            ],
            reasoning_effort: "high",
            max_completion_tokens: 100000,
        });

        const aiResponse = response.choices[0]?.message?.content || 'No response generated';
        this._conversationHistory.push(
            { role: "user", content: userMessage },
            { role: "assistant", content: aiResponse }
        );

        this._updateWebview(this._formatConversation());
        return aiResponse;
    }

    private _formatConversation(): string {
        return this._conversationHistory
            .map((msg, index) => {
                const speaker = msg.role === 'user' ? 
                    'User' : 
                    `AI ${this._currentIteration + 1} - ${index % 4 === 2 ? 'Generator' : 'Reviewer'}`;
                const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                return `<div class="${msg.role}-message">
                    <strong>${speaker}:</strong> ${this._formatCodeBlocks(content)}
                </div>`;
            })
            .join('\n');
    }

    private _formatCodeBlocks(content: string): string {
        return content.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => `
            <pre class="code-block ${lang || ''}">
                <code>${this._escapeHtml(code)}</code>
            </pre>
        `);
    }

    private _escapeHtml(unsafe: string): string {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    private _updateWebview(content: string) {
        this._panel.webview.html = this._getWebviewContent(content);
    }

    private _getWebviewContent(content: string) {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>AI Code Generation & Review</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                }
                .user-message, .assistant-message {
                    margin: 10px 0;
                    padding: 10px;
                    border-radius: 5px;
                }
                .user-message {
                    background-color: var(--vscode-textBlockQuote-background);
                }
                .assistant-message {
                    background-color: var(--vscode-editor-lineHighlightBackground);
                }
                .code-block {
                    background-color: var(--vscode-editor-background);
                    padding: 10px;
                    border-radius: 5px;
                    overflow-x: auto;
                    margin: 10px 0;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-bottom: 20px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .iteration-info {
                    margin: 10px 0;
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <button onclick="startConversation()">Start New Code Generation</button>
            <div class="iteration-info">Current Iteration: ${this._currentIteration + 1} of ${this._maxIterations}</div>
            <div id="conversation">
                ${content}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.command) {
                        case 'continueConversation':
                            if (message.codeRequest && message.iterations) {
                                vscode.postMessage({
                                    command: 'continueConversation',
                                    codeRequest: message.codeRequest,
                                    iterations: message.iterations
                                });
                            }
                            break;
                    }
                });

                function startConversation() {
                    vscode.postMessage({
                        command: 'startConversation'
                    });
                }
            </script>
        </body>
        </html>`;
    }

    private _update() {
        this._updateWebview('Click "Start New Code Generation" to begin. You will be prompted to enter your code request and desired number of iterations.');
    }

    public dispose() {
        AIConversationPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('ai-conversation.startConversation', () => {
        AIConversationPanel.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {} 