import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeBaseDescription,
	INodeTypeDescription,
} from 'n8n-workflow';
import { BINARY_ENCODING, NodeOperationError } from 'n8n-workflow';

import type { Sheet2JSONOpts, WorkBook, ParsingOptions } from 'xlsx';

import { read as xlsxRead, readFile as xlsxReadFile, utils as xlsxUtils } from 'xlsx';
import { parse as createCSVParser } from 'csv-parse';

import {
	operationProperties,
	fromFileProperties,
	toFileProperties,
	optionsProperties,
	fromFileV2Properties,
} from '../description';
import { generatePairedItemData } from '@utils/utilities';
import type { JsonToSpreadsheetBinaryFormat, JsonToSpreadsheetBinaryOptions } from '@utils/binary';
import { convertJsonToSpreadsheetBinary } from '@utils/binary';

export class SpreadsheetFileV2 implements INodeType {
	description: INodeTypeDescription;

	constructor(baseDescription: INodeTypeBaseDescription) {
		this.description = {
			...baseDescription,
			version: 2,
			defaults: {
				name: 'Spreadsheet File',
				color: '#2244FF',
			},
			inputs: ['main'],
			outputs: ['main'],
			properties: [
				...operationProperties,
				...fromFileProperties,
				...fromFileV2Properties,
				...toFileProperties,
				...optionsProperties,
			],
		};
	}

	async execute(this: IExecuteFunctions) {
		const items = this.getInputData();
		const operation = this.getNodeParameter('operation', 0);
		const newItems: INodeExecutionData[] = [];

		if (operation === 'fromFile') {
			// Read data from spreadsheet file to workflow
			for (let i = 0; i < items.length; i++) {
				try {
					const options = this.getNodeParameter('options', i, {});
					let fileFormat = this.getNodeParameter('fileFormat', i, {});
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i);
					const binaryData = this.helpers.assertBinaryData(i, binaryPropertyName);

					let rows: unknown[] = [];

					if (
						fileFormat === 'autodetect' &&
						(binaryData.mimeType === 'text/csv' ||
							(binaryData.mimeType === 'text/plain' && binaryData.fileExtension === 'csv'))
					) {
						fileFormat = 'csv';
					}

					if (fileFormat === 'csv') {
						const maxRowCount = options.maxRowCount as number;
						const parser = createCSVParser({
							delimiter: options.delimiter as string,
							fromLine: options.fromLine as number,
							bom: options.enableBOM as boolean,
							to: maxRowCount > -1 ? maxRowCount : undefined,
							columns: options.headerRow !== false,
							onRecord: (record) => {
								if (!options.includeEmptyCells) {
									record = Object.fromEntries(
										Object.entries(record).filter(([_key, value]) => value !== ''),
									);
								}
								rows.push(record);
							},
						});
						if (binaryData.id) {
							const stream = await this.helpers.getBinaryStream(binaryData.id);
							await new Promise<void>(async (resolve, reject) => {
								parser.on('error', reject);
								parser.on('readable', () => {
									stream.unpipe(parser);
									stream.destroy();
									resolve();
								});
								stream.pipe(parser);
							});
						} else {
							parser.write(binaryData.data, BINARY_ENCODING);
							parser.end();
						}
					} else {
						let workbook: WorkBook;
						const xlsxOptions: ParsingOptions = { raw: options.rawData as boolean };
						if (options.readAsString) xlsxOptions.type = 'string';

						if (binaryData.id) {
							const binaryPath = this.helpers.getBinaryPath(binaryData.id);
							workbook = xlsxReadFile(binaryPath, xlsxOptions);
						} else {
							const binaryDataBuffer = Buffer.from(binaryData.data, BINARY_ENCODING);
							workbook = xlsxRead(
								options.readAsString ? binaryDataBuffer.toString() : binaryDataBuffer,
								xlsxOptions,
							);
						}

						if (workbook.SheetNames.length === 0) {
							throw new NodeOperationError(
								this.getNode(),
								'Spreadsheet does not have any sheets!',
								{
									itemIndex: i,
								},
							);
						}

						let sheetName = workbook.SheetNames[0];
						if (options.sheetName) {
							if (!workbook.SheetNames.includes(options.sheetName as string)) {
								throw new NodeOperationError(
									this.getNode(),
									`Spreadsheet does not contain sheet called "${options.sheetName}"!`,
									{ itemIndex: i },
								);
							}
							sheetName = options.sheetName as string;
						}

						// Convert it to json
						const sheetToJsonOptions: Sheet2JSONOpts = {};
						if (options.range) {
							if (isNaN(options.range as number)) {
								sheetToJsonOptions.range = options.range;
							} else {
								sheetToJsonOptions.range = parseInt(options.range as string, 10);
							}
						}

						if (options.includeEmptyCells) {
							sheetToJsonOptions.defval = '';
						}

						if (options.headerRow === false) {
							sheetToJsonOptions.header = 1; // Consider the first row as a data row
						}

						rows = xlsxUtils.sheet_to_json(workbook.Sheets[sheetName], sheetToJsonOptions);

						// Check if data could be found in file
						if (rows.length === 0) {
							continue;
						}
					}

					// Add all the found data columns to the workflow data
					if (options.headerRow === false) {
						// Data was returned as an array - https://github.com/SheetJS/sheetjs#json
						for (const rowData of rows) {
							newItems.push({
								json: {
									row: rowData,
								},
								pairedItem: {
									item: i,
								},
							} as INodeExecutionData);
						}
					} else {
						for (const rowData of rows) {
							newItems.push({
								json: rowData,
								pairedItem: {
									item: i,
								},
							} as INodeExecutionData);
						}
					}
				} catch (error) {
					if (this.continueOnFail()) {
						newItems.push({
							json: {
								error: error.message,
							},
							pairedItem: {
								item: i,
							},
						});
						continue;
					}
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i });
				}
			}

			return [newItems];
		}

		if (operation === 'toFile') {
			const pairedItem = generatePairedItemData(items.length);
			try {
				const binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0);
				const fileFormat = this.getNodeParameter('fileFormat', 0) as JsonToSpreadsheetBinaryFormat;
				const options = this.getNodeParameter('options', 0, {}) as JsonToSpreadsheetBinaryOptions;

				const binaryData = await convertJsonToSpreadsheetBinary.call(
					this,
					items,
					fileFormat,
					options,
				);

				const newItem: INodeExecutionData = {
					json: {},
					binary: {
						[binaryPropertyName]: binaryData,
					},
					pairedItem,
				};

				newItems.push(newItem);
			} catch (error) {
				if (this.continueOnFail()) {
					newItems.push({
						json: {
							error: error.message,
						},
						pairedItem,
					});
				} else {
					throw error;
				}
			}
		}

		return [newItems];
	}
}
