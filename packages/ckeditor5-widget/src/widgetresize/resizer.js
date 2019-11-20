/**
 * @license Copyright (c) 2003-2019, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md or https://ckeditor.com/legal/ckeditor-oss-license
 */

/**
 * @module widget/widgetresize/resizer
 */

import View from '@ckeditor/ckeditor5-ui/src/view';
import Template from '@ckeditor/ckeditor5-ui/src/template';
import Rect from '@ckeditor/ckeditor5-utils/src/dom/rect';

import ObservableMixin from '@ckeditor/ckeditor5-utils/src/observablemixin';
import mix from '@ckeditor/ckeditor5-utils/src/mix';

import ResizeState from './resizerstate';

/**
 * Represents a resizer for a single resizable object.
 *
 * @mixes module:utils/observablemixin~ObservableMixin
 */
export default class Resizer {
	/**
	 * @param {module:widget/widgetresize~ResizerOptions} options Resizer options.
	 */
	constructor( options ) {
		/**
		 * Stores the state of the resizable host geometry, such as the original width, the currently proposed height, etc.
		 *
		 * Note that a new state is created for each resize transaction.
		 *
		 * @readonly
		 * @member {module:widget/widgetresize/resizerstate~ResizerState} #state
		 */

		/**
		 * A view displaying the proposed new element size during the resizing.
		 *
		 * @protected
		 * @readonly
		 * @member {module:widget/widgetresize/resizer~SizeView} #_sizeUI
		 */

		/**
		 * Options passed to the {@link #constructor}.
		 *
		 * @private
		 * @type {module:widget/widgetresize~ResizerOptions}
		 */
		this._options = options;

		/**
		 * Container of the entire resize UI.
		 *
		 * Note that this property is initialized only after the element bound with the resizer is drawn
		 * so it will be a `null` when uninitialized.
		 *
		 * @private
		 * @type {HTMLElement|null}
		 */
		this._domResizerWrapper = null;

		/**
		 * A wrapper that is controlled by the resizer. This is usually a widget element.
		 *
		 * @private
		 * @type {module:engine/view/element~Element|null}
		 */
		this._viewResizerWrapper = null;

		/**
		 * @observable
		 */
		this.set( 'isEnabled', true );

		this.decorate( 'begin' );
		this.decorate( 'cancel' );
		this.decorate( 'commit' );
		this.decorate( 'updateSize' );

		this.on( 'commit', event => {
			// State might not be initialized yet. In this case, prevent further handling and make sure that the resizer is cleaned up (#5195).
			if ( !this.state.proposedWidth ) {
				this._cleanup();
				event.stop();
			}
		}, { priority: 'high' } );
	}

	/**
	 * Attaches the resizer to the DOM.
	 */
	attach() {
		const that = this;
		const widgetElement = this._options.viewElement;
		const writer = this._options.downcastWriter;

		const viewResizerWrapper = writer.createUIElement( 'div', {
			class: 'ck ck-reset_all ck-widget__resizer'
		}, function( domDocument ) {
			const domElement = this.toDomElement( domDocument );

			that._appendHandles( domElement );
			that._appendSizeUI( domElement );

			that._domResizerWrapper = domElement;

			that.on( 'change:isEnabled', ( evt, propName, newValue ) => {
				domElement.style.display = newValue ? '' : 'none';
			} );

			domElement.style.display = that.isEnabled ? '' : 'none';

			return domElement;
		} );

		// Append the resizer wrapper to the widget's wrapper.
		writer.insert( writer.createPositionAt( widgetElement, 'end' ), viewResizerWrapper );
		writer.addClass( 'ck-widget_with-resizer', widgetElement );

		this._viewResizerWrapper = viewResizerWrapper;
	}

	/**
	 * Starts the resizing process.
	 *
	 * Creates a new {@link #state} for the current process.
	 *
	 * @fires begin
	 * @param {HTMLElement} domResizeHandle Clicked handle.
	 */
	begin( domResizeHandle ) {
		this.state = new ResizeState( this._options );

		this._sizeUI.bindToState( this._options, this.state );

		this.state.begin( domResizeHandle, this._getHandleHost(), this._getResizeHost() );
	}

	/**
	 * Updates the proposed size based on `domEventData`.
	 *
	 * @fires updateSize
	 * @param {Event} domEventData
	 */
	updateSize( domEventData ) {
		const newSize = this._proposeNewSize( domEventData );
		const editingView = this._options.editor.editing.view;

		editingView.change( writer => {
			const unit = this._options.unit;
			const newWidth = ( unit === '%' ? newSize.widthPercents : newSize.width ) + unit;

			writer.setStyle( 'width', newWidth, this._options.viewElement );
		} );

		// Get an actual image width, and:
		// * reflect this size to the resize wrapper
		// * apply this **real** size to the state
		const domHandleHost = this._getHandleHost();
		const domHandleHostRect = new Rect( domHandleHost );

		newSize.handleHostWidth = Math.round( domHandleHostRect.width );
		newSize.handleHostHeight = Math.round( domHandleHostRect.height );

		// Handle max-width limitation.
		const domResizeHostRect = new Rect( domHandleHost );

		newSize.width = Math.round( domResizeHostRect.width );
		newSize.height = Math.round( domResizeHostRect.height );

		this.redraw( domHandleHostRect );

		this.state.update( newSize );
	}

	/**
	 * Applies the geometry proposed with the resizer.
	 *
	 * @fires commit
	 */
	commit() {
		const unit = this._options.unit;
		const newValue = ( unit === '%' ? this.state.proposedWidthPercents : this.state.proposedWidth ) + this._options.unit;

		this._options.onCommit( newValue );

		this._cleanup();
	}

	/**
	 * Cancels and rejects the proposed resize dimensions, hiding the UI.
	 *
	 * @fires cancel
	 */
	cancel() {
		this._cleanup();
	}

	/**
	 * Destroys the resizer.
	 */
	destroy() {
		this.cancel();
	}

	/**
	 * Redraws the resizer.
	 *
	 * @param {module:utils/dom/rect~Rect} [handleHostRect] Handle host rectangle might be given to improve performance.
	 */
	redraw( handleHostRect ) {
		const domWrapper = this._domResizerWrapper;

		if ( existsInDom( domWrapper ) ) {
			this._options.editor.editing.view.change( writer => {
				// Refresh only if resizer exists in the DOM.
				const widgetWrapper = domWrapper.parentElement;
				const handleHost = this._getHandleHost();
				const clientRect = handleHostRect || new Rect( handleHost );

				writer.setStyle( 'width', clientRect.width + 'px', this._viewResizerWrapper );
				writer.setStyle( 'height', clientRect.height + 'px', this._viewResizerWrapper );

				const offsets = {
					left: handleHost.offsetLeft,
					top: handleHost.offsetTop,
					height: handleHost.offsetHeight,
					width: handleHost.offsetWidth
				};

				// In case a resizing host is not a widget wrapper, we need to compensate
				// for any additional offsets the resize host might have. E.g. wrapper padding
				// or simply another editable. By doing that the border and resizers are shown
				// only around the resize host.
				if ( !widgetWrapper.isSameNode( handleHost ) ) {
					writer.setStyle( 'left', offsets.left + 'px', this._viewResizerWrapper );
					writer.setStyle( 'top', offsets.top + 'px', this._viewResizerWrapper );

					writer.setStyle( 'height', offsets.height + 'px', this._viewResizerWrapper );
					writer.setStyle( 'width', offsets.width + 'px', this._viewResizerWrapper );
				}
			} );
		}

		function existsInDom( element ) {
			return element && element.ownerDocument && element.ownerDocument.contains( element );
		}
	}

	containsHandle( domElement ) {
		return this._domResizerWrapper.contains( domElement );
	}

	static isResizeHandle( domElement ) {
		return domElement.classList.contains( 'ck-widget__resizer__handle' );
	}

	/**
	 * Cleans up the context state.
	 *
	 * @protected
	 */
	_cleanup() {
		this._sizeUI.dismiss();
		this._sizeUI.isVisible = false;
	}

	/**
	 * Calculates the proposed size as the resize handles are dragged.
	 *
	 * @private
	 * @param {Event} domEventData Event data that caused the size update request. It should be used to calculate the proposed size.
	 * @returns {Object} return
	 * @returns {Number} return.width Proposed width.
	 * @returns {Number} return.height Proposed height.
	 */
	_proposeNewSize( domEventData ) {
		const state = this.state;
		const currentCoordinates = extractCoordinates( domEventData );
		const isCentered = this._options.isCentered ? this._options.isCentered( this ) : true;

		// Enlargement defines how much the resize host has changed in a given axis. Naturally it could be a negative number
		// meaning that it has been shrunk.
		//
		// +----------------+--+
		// |                |  |
		// |       img      |  |
		// |  /handle host  |  |
		// +----------------+  | ^
		// |                   | | - enlarge y
		// +-------------------+ v
		// 					<-->
		// 					 enlarge x
		const enlargement = {
			x: state._referenceCoordinates.x - ( currentCoordinates.x + state.originalWidth ),
			y: ( currentCoordinates.y - state.originalHeight ) - state._referenceCoordinates.y
		};

		if ( isCentered && state.activeHandlePosition.endsWith( '-right' ) ) {
			enlargement.x = currentCoordinates.x - ( state._referenceCoordinates.x + state.originalWidth );
		}

		// Objects needs to be resized twice as much in horizontal axis if centered, since enlargement is counted from
		// one resized corner to your cursor. It needs to be duplicated to compensate for the other side too.
		if ( isCentered ) {
			enlargement.x *= 2;
		}

		// const resizeHost = this._getResizeHost();

		// The size proposed by the user. It does not consider the aspect ratio.
		const proposedSize = {
			width: Math.abs( state.originalWidth + enlargement.x ),
			height: Math.abs( state.originalHeight + enlargement.y )
		};

		// Dominant determination must take the ratio into account.
		proposedSize.dominant = proposedSize.width / state.aspectRatio > proposedSize.height ? 'width' : 'height';
		proposedSize.max = proposedSize[ proposedSize.dominant ];

		// Proposed size, respecting the aspect ratio.
		const targetSize = {
			width: proposedSize.width,
			height: proposedSize.height
		};

		if ( proposedSize.dominant == 'width' ) {
			targetSize.height = targetSize.width / state.aspectRatio;
		} else {
			targetSize.width = targetSize.height * state.aspectRatio;
		}

		return {
			width: Math.round( targetSize.width ),
			height: Math.round( targetSize.height ),
			widthPercents: Math.min( Math.round( state.originalWidthPercents / state.originalWidth * targetSize.width * 100 ) / 100, 100 )
		};
	}

	/**
	 * Obtains the resize host.
	 *
	 * Resize host is an object that receives dimensions which are the result of resizing.
	 *
	 * @protected
	 * @returns {HTMLElement}
	 */
	_getResizeHost() {
		const widgetWrapper = this._domResizerWrapper.parentElement;

		return this._options.getResizeHost( widgetWrapper );
	}

	/**
	 * Obtains the handle host.
	 *
	 * Handle host is an object that the handles are aligned to.
	 *
	 * Handle host will not always be an entire widget itself. Take an image as an example. The image widget
	 * contains an image and a caption. Only the image should be surrounded with handles.
	 *
	 * @protected
	 * @returns {HTMLElement}
	 */
	_getHandleHost() {
		const widgetWrapper = this._domResizerWrapper.parentElement;

		return this._options.getHandleHost( widgetWrapper );
	}

	/**
	 * Renders the resize handles in the DOM.
	 *
	 * @private
	 * @param {HTMLElement} domElement The resizer wrapper.
	 */
	_appendHandles( domElement ) {
		const resizerPositions = [ 'top-left', 'top-right', 'bottom-right', 'bottom-left' ];

		for ( const currentPosition of resizerPositions ) {
			domElement.appendChild( ( new Template( {
				tag: 'div',
				attributes: {
					class: `ck-widget__resizer__handle ${ getResizerClass( currentPosition ) }`
				}
			} ).render() ) );
		}
	}

	/**
	 * Sets up the {@link #_sizeUI} property and adds it to the passed `domElement`.
	 *
	 * @private
	 * @param {HTMLElement} domElement
	 */
	_appendSizeUI( domElement ) {
		const sizeUI = new SizeView();

		// Make sure icon#element is rendered before passing to appendChild().
		sizeUI.render();

		this._sizeUI = sizeUI;

		domElement.appendChild( sizeUI.element );
	}

	/**
	 * Determines the position of a given resize handle.
	 *
	 * @private
	 * @param {HTMLElement} domHandle Handle used to calculate the reference point.
	 * @returns {String|undefined} Returns a string like `"top-left"` or `undefined` if not matched.
	 */
	_getHandlePosition( domHandle ) {
		const resizerPositions = [ 'top-left', 'top-right', 'bottom-right', 'bottom-left' ];

		for ( const position of resizerPositions ) {
			if ( domHandle.classList.contains( getResizerClass( position ) ) ) {
				return position;
			}
		}
	}

	/**
	 * @event begin
	 */

	/**
	 * @event updateSize
	 */

	/**
	 * @event commit
	 */

	/**
	 * @event cancel
	 */
}

mix( Resizer, ObservableMixin );

/**
 * A view displaying the proposed new element size during the resizing.
 *
 * @extends {module:ui/view~View}
 */
class SizeView extends View {
	constructor() {
		super();

		const bind = this.bindTemplate;

		this.setTemplate( {
			tag: 'div',
			attributes: {
				class: [
					'ck',
					'ck-size-view',
					bind.to( 'activeHandlePosition', value => value ? `ck-orientation-${ value }` : '' )
				],
				style: {
					display: bind.if( 'isVisible', 'none', visible => !visible )
				}
			},
			children: [ {
				text: bind.to( 'label' )
			} ]
		} );
	}

	bindToState( options, resizerState ) {
		this.bind( 'isVisible' ).to( resizerState, 'proposedWidth', resizerState, 'proposedHeight', ( width, height ) =>
			width !== null && height !== null );

		this.bind( 'label' ).to(
			resizerState, 'proposedHandleHostWidth',
			resizerState, 'proposedHandleHostHeight',
			resizerState, 'proposedWidthPercents',
			( width, height, widthPercents ) => {
				if ( options.unit === 'px' ) {
					return `${ width }×${ height }`;
				} else {
					return `${ widthPercents }%`;
				}
			}
		);

		this.bind( 'activeHandlePosition' ).to( resizerState );
	}

	dismiss() {
		this.unbind();
		this.isVisible = false;
	}
}

// @private
// @param {String} resizerPosition Expected resizer position like `"top-left"`, `"bottom-right"`.
// @returns {String} A prefixed HTML class name for the resizer element
function getResizerClass( resizerPosition ) {
	return `ck-widget__resizer__handle-${ resizerPosition }`;
}

function extractCoordinates( event ) {
	return {
		x: event.pageX,
		y: event.pageY
	};
}
