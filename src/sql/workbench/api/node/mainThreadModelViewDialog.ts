/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { IWorkbenchEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { extHostNamedCustomer } from 'vs/workbench/api/electron-browser/extHostCustomers';
import { IExtHostContext } from 'vs/workbench/api/node/extHost.protocol';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

import { MainThreadModelViewDialogShape, SqlMainContext, ExtHostModelViewDialogShape, SqlExtHostContext } from 'sql/workbench/api/node/sqlExtHost.protocol';
import { Dialog, DialogTab, DialogButton, WizardPage, Wizard } from 'sql/platform/dialog/dialogTypes';
import { CustomDialogService } from 'sql/platform/dialog/customDialogService';
import { IModelViewDialogDetails, IModelViewTabDetails, IModelViewButtonDetails, IModelViewWizardPageDetails, IModelViewWizardDetails } from 'sql/workbench/api/common/sqlExtHostTypes';
import { ModelViewInput } from 'sql/parts/modelComponents/modelEditor/modelViewInput';

import * as vscode from 'vscode';
import * as sqlops from 'sqlops';

@extHostNamedCustomer(SqlMainContext.MainThreadModelViewDialog)
export class MainThreadModelViewDialog implements MainThreadModelViewDialogShape {
	private readonly _proxy: ExtHostModelViewDialogShape;
	private readonly _dialogs = new Map<number, Dialog>();
	private readonly _tabs = new Map<number, DialogTab>();
	private readonly _buttons = new Map<number, DialogButton>();
	private readonly _wizardPages = new Map<number, WizardPage>();
	private readonly _wizardPageHandles = new Map<WizardPage, number>();
	private readonly _wizards = new Map<number, Wizard>();
	private _dialogService: CustomDialogService;

	constructor(
		context: IExtHostContext,
		@IInstantiationService private _instatiationService: IInstantiationService,
		@IWorkbenchEditorService private _editorService: IWorkbenchEditorService
	) {
		this._proxy = context.getProxy(SqlExtHostContext.ExtHostModelViewDialog);
		this._dialogService = new CustomDialogService(_instatiationService);
	}

	public dispose(): void {
		throw new Error('Method not implemented.');
	}

	public $openEditor(modelViewId: string, title: string, options?: sqlops.ModelViewEditorOptions, position?: vscode.ViewColumn): Thenable<void> {
		return new Promise<void>((resolve, reject) => {
			let input = this._instatiationService.createInstance(ModelViewInput, title, modelViewId, options);
			let editorOptions = {
				preserveFocus: true,
				pinned: true
			};

			this._editorService.openEditor(input, editorOptions, position as any).then(() => {
				resolve();
			}, error => {
				reject(error);
			});
		});
	}

	public $openDialog(handle: number): Thenable<void> {
		let dialog = this.getDialog(handle);
		this._dialogService.showDialog(dialog);
		return Promise.resolve();
	}

	public $closeDialog(handle: number): Thenable<void> {
		let dialog = this.getDialog(handle);
		this._dialogService.closeDialog(dialog);
		return Promise.resolve();
	}

	public $setDialogDetails(handle: number, details: IModelViewDialogDetails): Thenable<void> {
		let dialog = this._dialogs.get(handle);
		if (!dialog) {
			dialog = new Dialog(details.title);
			let okButton = this.getButton(details.okButton);
			let cancelButton = this.getButton(details.cancelButton);
			dialog.okButton = okButton;
			dialog.cancelButton = cancelButton;
			dialog.onValidityChanged(valid => this._proxy.$onPanelValidityChanged(handle, valid));
			dialog.registerCloseValidator(() => this.validateDialogClose(handle));
			this._dialogs.set(handle, dialog);
		}

		dialog.title = details.title;
		if (details.content && typeof details.content !== 'string') {
			dialog.content = details.content.map(tabHandle => this.getTab(tabHandle));
		} else {
			dialog.content = details.content as string;
		}

		if (details.customButtons) {
			dialog.customButtons = details.customButtons.map(buttonHandle => this.getButton(buttonHandle));
		}

		dialog.message = details.message;

		return Promise.resolve();
	}

	public $setTabDetails(handle: number, details: IModelViewTabDetails): Thenable<void> {
		let tab = this._tabs.get(handle);
		if (!tab) {
			tab = new DialogTab(details.title);
			tab.onValidityChanged(valid => this._proxy.$onPanelValidityChanged(handle, valid));
			this._tabs.set(handle, tab);
		}

		tab.title = details.title;
		tab.content = details.content;
		return Promise.resolve();
	}

	public $setButtonDetails(handle: number, details: IModelViewButtonDetails): Thenable<void> {
		let button = this._buttons.get(handle);
		if (!button) {
			button = new DialogButton(details.label, details.enabled);
			button.hidden = details.hidden;
			button.onClick(() => this.onButtonClick(handle));
			this._buttons.set(handle, button);
		} else {
			button.label = details.label;
			button.enabled = details.enabled;
			button.hidden = details.hidden;
		}

		return Promise.resolve();
	}

	public $setWizardPageDetails(handle: number, details: IModelViewWizardPageDetails): Thenable<void> {
		let page = this._wizardPages.get(handle);
		if (!page) {
			page = new WizardPage(details.title, details.content);
			page.onValidityChanged(valid => this._proxy.$onPanelValidityChanged(handle, valid));
			this._wizardPages.set(handle, page);
			this._wizardPageHandles.set(page, handle);
		}

		page.title = details.title;
		page.content = details.content;
		page.enabled = details.enabled;
		page.description = details.description;
		if (details.customButtons !== undefined) {
			page.customButtons = details.customButtons.map(buttonHandle => this.getButton(buttonHandle));
		}

		return Promise.resolve();
	}

	public $setWizardDetails(handle: number, details: IModelViewWizardDetails): Thenable<void> {
		let wizard = this._wizards.get(handle);
		if (!wizard) {
			wizard = new Wizard(details.title);
			wizard.backButton = this.getButton(details.backButton);
			wizard.cancelButton = this.getButton(details.cancelButton);
			wizard.generateScriptButton = this.getButton(details.generateScriptButton);
			wizard.doneButton = this.getButton(details.doneButton);
			wizard.nextButton = this.getButton(details.nextButton);
			wizard.onPageChanged(info => this._proxy.$onWizardPageChanged(handle, info));
			wizard.onPageAdded(() => this.handleWizardPageAddedOrRemoved(handle));
			wizard.onPageRemoved(() => this.handleWizardPageAddedOrRemoved(handle));
			wizard.registerNavigationValidator(info => this.validateNavigation(handle, info));
			this._wizards.set(handle, wizard);
		}

		wizard.title = details.title;
		wizard.displayPageTitles = details.displayPageTitles;
		wizard.pages = details.pages.map(handle => this.getWizardPage(handle));
		if (details.currentPage !== undefined) {
			wizard.setCurrentPage(details.currentPage);
		}
		if (details.customButtons !== undefined) {
			wizard.customButtons = details.customButtons.map(buttonHandle => this.getButton(buttonHandle));
		}
		wizard.message = details.message;

		return Promise.resolve();
	}

	public $addWizardPage(wizardHandle: number, pageHandle: number, pageIndex?: number): Thenable<void> {
		if (pageIndex === null) {
			pageIndex = undefined;
		}
		let wizard = this.getWizard(wizardHandle);
		let page = this.getWizardPage(pageHandle);
		wizard.addPage(page, pageIndex);
		return Promise.resolve();
	}

	public $removeWizardPage(wizardHandle: number, pageIndex: number): Thenable<void> {
		let wizard = this.getWizard(wizardHandle);
		wizard.removePage(pageIndex);
		return Promise.resolve();
	}

	public $setWizardPage(wizardHandle: number, pageIndex: number): Thenable<void> {
		let wizard = this.getWizard(wizardHandle);
		wizard.setCurrentPage(pageIndex);
		return Promise.resolve();
	}

	public $openWizard(handle: number): Thenable<void> {
		let wizard = this.getWizard(handle);
		this._dialogService.showWizard(wizard);
		return Promise.resolve();
	}

	public $closeWizard(handle: number): Thenable<void> {
		let wizard = this.getWizard(handle);
		this._dialogService.closeWizard(wizard);
		return Promise.resolve();
	}

	private getDialog(handle: number): Dialog {
		let dialog = this._dialogs.get(handle);
		if (!dialog) {
			throw new Error('No dialog matching the given handle');
		}
		return dialog;
	}

	private getTab(handle: number): DialogTab {
		let tab = this._tabs.get(handle);
		if (!tab) {
			throw new Error('No tab matching the given handle');
		}
		return tab;
	}

	private getButton(handle: number): DialogButton {
		let button = this._buttons.get(handle);
		if (!button) {
			throw new Error('No button matching the given handle');
		}
		return button;
	}

	private onButtonClick(handle: number): void {
		this._proxy.$onButtonClick(handle);
	}

	private getWizardPage(handle: number): WizardPage {
		let page = this._wizardPages.get(handle);
		if (!page) {
			throw new Error('No page matching the given handle');
		}
		return page;
	}

	private getWizard(handle: number): Wizard {
		let wizard = this._wizards.get(handle);
		if (!wizard) {
			throw new Error('No wizard matching the given handle');
		}
		return wizard;
	}

	private handleWizardPageAddedOrRemoved(handle: number): void {
		let wizard = this._wizards.get(handle);
		this._proxy.$updateWizardPageInfo(handle, wizard.pages.map(page => this._wizardPageHandles.get(page)), wizard.currentPage);
	}

	private validateNavigation(handle: number, info: sqlops.window.modelviewdialog.WizardPageChangeInfo): Thenable<boolean> {
		return this._proxy.$validateNavigation(handle, info);
	}

	private validateDialogClose(handle: number): Thenable<boolean> {
		return this._proxy.$validateDialogClose(handle);
	}
}